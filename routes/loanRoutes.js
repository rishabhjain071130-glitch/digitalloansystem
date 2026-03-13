const express = require('express');
const Member = require('../models/Member');
const Loan = require('../models/Loan');
const Transaction = require('../models/Transaction');

const router = express.Router();
const requireAdmin = (req, res, next) => req.app.locals.requireAdmin(req, res, next);

const INTEREST_RATE = 0.06;
const MONTHLY_CD = 5000;
const MAX_LOANS_PER_MONTH = 4;

function getMonthKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function getSuggestedAmount(member) {
  const members = await Member.find();
  const allMembersTotalCD = members.reduce((sum, item) => sum + item.totalCD, 0);
  const candidateDueAmount = member.remainingAmount || 0;

  const suggestedAmountRaw =
    member.totalCD > 0
      ? ((member.monthlyCD / member.totalCD) * allMembersTotalCD) - candidateDueAmount
      : 0;

  return Math.max(0, Number(suggestedAmountRaw.toFixed(2)));
}

router.post('/loan/request', requireAdmin, async (req, res) => {
  try {
    const { memberId } = req.body;
    if (!memberId) {
      return res.status(400).json({ message: 'memberId is required.' });
    }

    const member = await Member.findById(memberId);
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }

    const monthKey = getMonthKey();
    const existingPending = await Loan.findOne({ memberId: member._id, monthKey, status: 'requested' });
    if (existingPending) {
      return res.status(400).json({ message: 'A pending request already exists for this member this month.' });
    }

    const suggestedAmount = await getSuggestedAmount(member);
    const loan = await Loan.create({
      memberId: member._id,
      memberName: member.name,
      monthKey,
      suggestedAmount,
      approvedAmount: 0,
      interestRate: INTEREST_RATE,
      paidAmount: Number(member.paidAmount.toFixed(2)),
      remainingAmount: Number(member.remainingAmount.toFixed(2)),
      status: 'requested'
    });

    return res.status(201).json({
      message: 'Loan request created.',
      suggestedAmount,
      loan
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/loan/decision', requireAdmin, async (req, res) => {
  try {
    const { loanId, action, approvedAmount, rejectedReason = '' } = req.body;
    if (!loanId || !action) {
      return res.status(400).json({ message: 'loanId and action are required.' });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'action must be approve or reject.' });
    }

    const loan = await Loan.findById(loanId);
    if (!loan) {
      return res.status(404).json({ message: 'Loan request not found.' });
    }

    if (loan.status !== 'requested') {
      return res.status(400).json({ message: 'Loan request already decided.' });
    }

    if (action === 'reject') {
      loan.status = 'rejected';
      loan.rejectedReason = rejectedReason;
      loan.decidedAt = new Date();
      await loan.save();
      return res.json({ message: 'Loan request rejected.', loan });
    }

    const monthKey = loan.monthKey;
    const approvedCount = await Loan.countDocuments({ monthKey, status: 'approved' });
    if (approvedCount >= MAX_LOANS_PER_MONTH) {
      return res.status(400).json({ message: 'Only 4 members can receive loan per month.' });
    }

    const member = await Member.findById(loan.memberId);
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }

    const suggestedAmount = await getSuggestedAmount(member);
    const finalApproved = Math.max(0, Number((approvedAmount ?? suggestedAmount).toFixed(2)));

    member.loanAmount += finalApproved;
    member.remainingAmount += finalApproved;
    await member.save();

    loan.suggestedAmount = suggestedAmount;
    loan.approvedAmount = finalApproved;
    loan.remainingAmount = Number(member.remainingAmount.toFixed(2));
    loan.paidAmount = Number(member.paidAmount.toFixed(2));
    loan.status = member.remainingAmount > 0 ? 'approved' : 'closed';
    loan.decidedAt = new Date();
    await loan.save();

    return res.json({
      message: 'Loan approved successfully.',
      suggestedAmount,
      approvedAmount: finalApproved,
      loan
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/loan', requireAdmin, async (req, res) => {
  try {
    const { memberId, approvedAmount } = req.body;
    if (!memberId) {
      return res.status(400).json({ message: 'memberId is required.' });
    }

    const member = await Member.findById(memberId);
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }

    const monthKey = getMonthKey();
    const loansCount = await Loan.countDocuments({ monthKey });
    if (loansCount >= MAX_LOANS_PER_MONTH) {
      return res.status(400).json({ message: 'Only 4 members can receive loan per month.' });
    }

    const suggestedAmount = await getSuggestedAmount(member);
    const finalApproved = Math.max(0, Number((approvedAmount ?? suggestedAmount).toFixed(2)));

    member.loanAmount += finalApproved;
    member.remainingAmount += finalApproved;
    await member.save();

    const loan = await Loan.create({
      memberId: member._id,
      memberName: member.name,
      monthKey,
      suggestedAmount,
      approvedAmount: finalApproved,
      interestRate: INTEREST_RATE,
      paidAmount: 0,
      remainingAmount: member.remainingAmount,
      status: member.remainingAmount > 0 ? 'approved' : 'closed',
      decidedAt: new Date()
    });

    return res.status(201).json({
      message: 'Loan approved successfully.',
      suggestedAmount,
      approvedAmount: finalApproved,
      loan
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/monthlyClose', requireAdmin, async (req, res) => {
  try {
    const { payments = {} } = req.body;
    const monthKey = getMonthKey();
    const members = await Member.find();

    if (members.length === 0) {
      return res.status(400).json({ message: 'No members found.' });
    }

    let totalInterestCollected = 0;

    for (const member of members) {
      const paymentForMember = Number(payments[String(member._id)] || 0);

      member.monthlyCD = MONTHLY_CD;
      member.totalCD += MONTHLY_CD;

      const monthlyInterest = Number(((member.remainingAmount || 0) * (INTEREST_RATE / 12)).toFixed(2));
      if (monthlyInterest > 0) {
        member.interest += monthlyInterest;
        member.remainingAmount += monthlyInterest;
        totalInterestCollected += monthlyInterest;
      }

      if (paymentForMember > 0) {
        const appliedPayment = Math.min(paymentForMember, member.remainingAmount);
        member.paidAmount += appliedPayment;
        member.remainingAmount -= appliedPayment;
      }

      const paymentDate = new Date();
      member.lastPaymentDate = paymentDate;
      member.nextDueDate = new Date(paymentDate.getTime() + (30 * 24 * 60 * 60 * 1000));

      await member.save();
    }

    const refreshedMembers = await Member.find();
    const allMembersTotalCD = refreshedMembers.reduce((sum, item) => sum + item.totalCD, 0);
    const dividendPerRupee = allMembersTotalCD > 0 ? totalInterestCollected / allMembersTotalCD : 0;

    const transactionDocs = [];

    for (const member of refreshedMembers) {
      const monthlyDividend = Number((member.totalCD * dividendPerRupee).toFixed(2));
      const rpdIncrement = Number((monthlyDividend * 0.25).toFixed(2));

      member.monthlyDividend = monthlyDividend;
      member.totalDividend += monthlyDividend;
      member.rpd25 += rpdIncrement;
      await member.save();

      const transaction = {
        memberId: member._id,
        memberName: member.name,
        month: monthKey,
        loanAmount: Number(member.loanAmount.toFixed(2)),
        paidAmount: Number(member.paidAmount.toFixed(2)),
        remainingAmount: Number(member.remainingAmount.toFixed(2)),
        interest: Number(member.interest.toFixed(2)),
        monthlyCDAmount: MONTHLY_CD,
        adjCDAmt: Number((MONTHLY_CD + rpdIncrement).toFixed(2)),
        totalCumulativeCDAmt: Number((member.totalCD + member.rpd25).toFixed(2)),
        totalCDAmt: Number(member.totalCD.toFixed(2)),
        monthlyDividend,
        totalDividend: Number(member.totalDividend.toFixed(2)),
        rpd25RollingPrincipalDeposit: Number(member.rpd25.toFixed(2))
      };

      transactionDocs.push(transaction);

      await Loan.updateMany(
        { memberId: member._id, status: 'approved' },
        {
          $set: {
            paidAmount: Number(member.paidAmount.toFixed(2)),
            remainingAmount: Number(member.remainingAmount.toFixed(2)),
            status: member.remainingAmount > 0 ? 'approved' : 'closed'
          }
        }
      );
    }

    await Transaction.insertMany(transactionDocs);

    return res.json({
      message: 'Monthly closing completed successfully.',
      month: monthKey,
      totalInterestCollected: Number(totalInterestCollected.toFixed(2)),
      dividendPerRupee: Number(dividendPerRupee.toFixed(6))
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get('/loans', requireAdmin, async (req, res) => {
  try {
    const loans = await Loan.find().sort({ createdAt: -1 });
    return res.json(loans);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get('/report/download', requireAdmin, async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ month: 1, createdAt: 1 });
    const headers = [
      'Month',
      'Member',
      'Loan Amount',
      'Paid Amount',
      'Remaining Amount',
      'Interest',
      'Monthly CD',
      'Adjusted CD',
      'Total Cumulative CD',
      'Total CD',
      'Monthly Dividend',
      'Total Dividend',
      'RPD-25'
    ];

    const rows = transactions.map((item) => [
      item.month,
      item.memberName,
      item.loanAmount,
      item.paidAmount,
      item.remainingAmount,
      item.interest,
      item.monthlyCDAmount,
      item.adjCDAmt,
      item.totalCumulativeCDAmt,
      item.totalCDAmt,
      item.monthlyDividend,
      item.totalDividend,
      item.rpd25RollingPrincipalDeposit
    ]);

    const csvBody = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="society-report.csv"');
    return res.send(csvBody);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get('/summary', requireAdmin, async (req, res) => {
  try {
    const members = await Member.find();
    const loans = await Loan.find().sort({ createdAt: -1 }).limit(100);
    const transactions = await Transaction.find().sort({ createdAt: -1 }).limit(200);

    const totals = members.reduce(
      (acc, member) => {
        acc.totalCD += member.totalCD;
        acc.totalLoans += member.loanAmount;
        acc.totalPaid += member.paidAmount;
        acc.totalRemaining += member.remainingAmount;
        acc.totalInterest += member.interest;
        acc.totalDividend += member.totalDividend;
        acc.totalRPD25 += member.rpd25;
        return acc;
      },
      {
        totalCD: 0,
        totalLoans: 0,
        totalPaid: 0,
        totalRemaining: 0,
        totalInterest: 0,
        totalDividend: 0,
        totalRPD25: 0
      }
    );

    const chartMap = transactions.reduce((acc, tx) => {
      if (!acc[tx.month]) {
        acc[tx.month] = 0;
      }
      acc[tx.month] += tx.totalCDAmt;
      return acc;
    }, {});

    const dividendMap = transactions.reduce((acc, tx) => {
      if (!acc[tx.month]) {
        acc[tx.month] = 0;
      }
      acc[tx.month] += tx.monthlyDividend;
      return acc;
    }, {});

    const loanDistribution = loans
      .filter((loan) => loan.status === 'approved' || loan.status === 'closed')
      .reduce((acc, loan) => {
        acc.push({
          memberName: loan.memberName,
          amount: Number(loan.approvedAmount.toFixed(2))
        });
        return acc;
      }, []);

    const cdGrowth = Object.entries(chartMap)
      .map(([month, value]) => ({ month, value: Number(value.toFixed(2)) }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const dividendHistory = Object.entries(dividendMap)
      .map(([month, value]) => ({ month, value: Number(value.toFixed(2)) }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return res.json({
      totals: {
        totalMembers: members.length,
        ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(v.toFixed(2))]))
      },
      members,
      loans,
      transactions,
      cdGrowth,
      loanDistribution,
      dividendHistory
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
