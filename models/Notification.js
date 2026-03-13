const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    memberId: { type: String, required: true, index: true },
    message: { type: String, required: true },
    type: { type: String, required: true, default: 'system' },
    isRead: { type: Boolean, default: false }
  },
  { timestamps: true }
);

module.exports = mongoose.models.Notification || mongoose.model('Notification', notificationSchema, 'notifications');
