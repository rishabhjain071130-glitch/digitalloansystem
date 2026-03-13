const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    memberId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    type: { type: String, required: true, default: 'CD' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true
    },
    screenshot: { type: String, required: true },
    approvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Payment || mongoose.model('Payment', paymentSchema, 'payments');
