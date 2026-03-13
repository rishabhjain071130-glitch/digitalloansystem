const express = require('express');
const Member = require('../models/Member');
const Loan = require('../models/Loan');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');

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

router.get('/api/dashboard/payment-due', requireAdmin, async (req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);

    const results = await Member.aggregate([
      {
        $addFields: {
          effectiveLastPaymentDate: { $ifNull: ['$lastPaymentDate', '$joinDate'] }
        }
      },
      {
        $addFields: {
          effectiveNextDueDate: {
            $ifNull: [
              '$nextDueDate',
              {
                $dateAdd: {
                  startDate: '$effectiveLastPaymentDate',
                  unit: 'day',
                  amount: 30
                }
              }
            ]
          }
        }
      },
      {
        $addFields: {
          dueStatus: {
            $switch: {
              branches: [
                { case: { $lt: ['$effectiveNextDueDate', startOfToday] }, then: 'overdue' },
                {
                  case: {
                    $and: [
                      { $gte: ['$effectiveNextDueDate', startOfToday] },
                      { $lt: ['$effectiveNextDueDate', endOfToday] }
                    ]
                  },
                  then: 'dueToday'
                },
                { case: { $gte: ['$effectiveNextDueDate', endOfToday] }, then: 'upcoming' }
              ],
              default: 'upcoming'
            }
          }
        }
      },
      {
        $facet: {
          summary: [
            {
              $group: {
                _id: null,
                totalMembers: { $sum: 1 },
                dueToday: { $sum: { $cond: [{ $eq: ['$dueStatus', 'dueToday'] }, 1, 0] } },
                overdue: { $sum: { $cond: [{ $eq: ['$dueStatus', 'overdue'] }, 1, 0] } },
                upcomingDue: { $sum: { $cond: [{ $eq: ['$dueStatus', 'upcoming'] }, 1, 0] } }
              }
            }
          ],
          overdueMembers: [
            { $match: { dueStatus: 'overdue' } },
            { $sort: { effectiveNextDueDate: 1 } },
            {
              $project: {
                _id: 1,
                memberId: 1,
                name: 1,
                dueDate: '$effectiveNextDueDate',
                status: '$dueStatus'
              }
            }
          ],
          dueTodayMembers: [
            { $match: { dueStatus: 'dueToday' } },
            { $sort: { effectiveNextDueDate: 1 } },
            {
              $project: {
                _id: 1,
                memberId: 1,
                name: 1,
                dueDate: '$effectiveNextDueDate',
                status: '$dueStatus'
              }
            }
          ],
          upcomingMembers: [
            { $match: { dueStatus: 'upcoming' } },
            { $sort: { effectiveNextDueDate: 1 } },
            { $limit: 10 },
            {
              $project: {
                _id: 1,
                memberId: 1,
                name: 1,
                dueDate: '$effectiveNextDueDate',
                status: '$dueStatus'
              }
            }
          ]
        }
      }
    ]);

    const payload = results[0] || {};
    const summary = payload.summary?.[0] || { totalMembers: 0, dueToday: 0, overdue: 0, upcomingDue: 0 };

    const reminderCandidates = [
      ...(payload.overdueMembers || []).map((item) => ({
        memberId: item.memberId,
        message: 'Loan repayment reminder: Your CD payment is overdue. Please pay immediately.',
        type: 'reminder'
      })),
      ...(payload.dueTodayMembers || []).map((item) => ({
        memberId: item.memberId,
        message: 'CD payment reminder: Your monthly CD payment is due today.',
        type: 'reminder'
      }))
    ];

    await Promise.all(
      reminderCandidates.map(async (entry) => {
        const existing = await Notification.findOne({
          memberId: entry.memberId,
          message: entry.message,
          type: entry.type,
          createdAt: { $gte: startOfToday, $lt: endOfToday }
        }).lean();

        if (!existing) {
          await Notification.create({
            memberId: entry.memberId,
            message: entry.message,
            type: entry.type,
            isRead: false
          });
        }
      })
    );

    return res.json({
      totalMembers: summary.totalMembers,
      dueToday: summary.dueToday,
      overdue: summary.overdue,
      upcomingDue: summary.upcomingDue,
      overdueMembers: payload.overdueMembers || [],
      dueTodayMembers: payload.dueTodayMembers || [],
      upcomingMembers: payload.upcomingMembers || []
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
