const mongoose = require('mongoose');

const ledgerTransactionSchema = new mongoose.Schema(
  {
    memberId: { type: String, required: true, index: true },
    date: { type: Date, default: Date.now, index: true },
    type: {
      type: String,
      enum: ['CD_PAYMENT', 'LOAN_DISBURSEMENT', 'LOAN_REPAYMENT', 'INTEREST_PAYMENT', 'DIVIDEND'],
      required: true
    },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, default: '' },
    balanceAfter: { type: Number, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.models.LedgerTransaction || mongoose.model('LedgerTransaction', ledgerTransactionSchema, 'transactions');
