const express = require('express');
const Member = require('../models/Member');
const Loan = require('../models/Loan');
const Transaction = require('../models/Transaction');

const router = express.Router();
const requireAdmin = (req, res, next) => req.app.locals.requireAdmin(req, res, next);

// GET /api/dashboard/fund-pool
// Returns aggregated fund pool metrics for the admin dashboard.
router.get('/api/dashboard/fund-pool', requireAdmin, async (req, res) => {
  try {
    const [cdResult, loanResult, interestResult] = await Promise.all([
      // Total CD collected: sum of Member.totalCD across all members
      Member.aggregate([
        { $group: { _id: null, total: { $sum: '$totalCD' } } }
      ]),
      // Total loans given: sum of approvedAmount for approved/closed loans
      Loan.aggregate([
        { $match: { status: { $in: ['approved', 'closed'] } } },
        { $group: { _id: null, total: { $sum: '$approvedAmount' } } }
      ]),
      // Total interest earned: sum of interest field across all transactions
      Transaction.aggregate([
        { $group: { _id: null, total: { $sum: '$interest' } } }
      ])
    ]);

    const totalCDCollected = cdResult[0]?.total || 0;
    const totalLoansGiven = loanResult[0]?.total || 0;
    const totalInterestEarned = interestResult[0]?.total || 0;

    // Fund Pool = CD Collected + Interest Earned - Loans Given
    const totalFundPool = totalCDCollected + totalInterestEarned - totalLoansGiven;

    return res.json({
      totalCDCollected,
      totalLoansGiven,
      totalInterestEarned,
      totalFundPool
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
