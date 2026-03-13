const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    memberId: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    email: { type: String, unique: true, required: true },
    passwordHash: { type: String, required: true, select: false },
    joinDate: { type: Date, default: Date.now },
    monthlyCD: { type: Number, default: 5000 },
    lastPaymentDate: { type: Date, default: Date.now },
    nextDueDate: { type: Date, default: () => new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)) },
    totalCD: { type: Number, default: 0 },
    loanAmount: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    interest: { type: Number, default: 0 },
    monthlyDividend: { type: Number, default: 0 },
    totalDividend: { type: Number, default: 0 },
    rpd25: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Member || mongoose.model('Member', memberSchema);
