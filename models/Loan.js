const mongoose = require('mongoose');

const loanSchema = new mongoose.Schema(
  {
    memberId: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    memberName: { type: String, required: true },
    monthKey: { type: String, required: true },
    suggestedAmount: { type: Number, default: 0 },
    approvedAmount: { type: Number, default: 0 },
    interestRate: { type: Number, default: 0.06 },
    paidAmount: { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'closed'],
      default: 'requested'
    },
    rejectedReason: { type: String, default: '' },
    decidedAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Loan || mongoose.model('Loan', loanSchema);
