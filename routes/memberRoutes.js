const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const LedgerTransaction = require('../models/LedgerTransaction');
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');

const router = express.Router();
const requireAdmin = (req, res, next) => req.app.locals.requireAdmin(req, res, next);

const MAX_MEMBERS = 19;
const JOINING_DEPOSIT = 10000;
const MONTHLY_CD = 5000;
const memberSessionStore = new Map();

const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `payment-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Only png, jpg, jpeg files are allowed.'));
    }
    return cb(null, true);
  }
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function issueMemberToken(memberId) {
  const token = crypto.randomBytes(32).toString('hex');
  memberSessionStore.set(token, { memberId, createdAt: Date.now() });
  return token;
}

function extractBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

function requireMember(req, res, next) {
  const token = extractBearerToken(req);
  const session = token ? memberSessionStore.get(token) : null;
  if (!session) {
    return res.status(401).json({ message: 'Unauthorized member access.' });
  }

  const requestedMemberId = (req.params.memberId || '').toUpperCase();
  if (requestedMemberId && session.memberId !== requestedMemberId) {
    return res.status(403).json({ message: 'You can access only your own records.' });
  }

  req.memberSession = session;
  req.memberToken = token;
  return next();
}

async function generateNextMemberCode() {
  const existing = await Member.find({}, { memberId: 1, _id: 0 }).lean();
  const usedNumbers = new Set(
    existing
      .map((item) => {
        const match = String(item.memberId || '').match(/^M(\d{3})$/);
        return match ? Number(match[1]) : null;
      })
      .filter((num) => Number.isFinite(num))
  );

  for (let index = 1; index <= MAX_MEMBERS; index += 1) {
    if (!usedNumbers.has(index)) {
      return `M${String(index).padStart(3, '0')}`;
    }
  }

  return null;
}

function buildMemberPayload({ name, email, monthlyCD, memberId, passwordHash }) {
  const joinDate = new Date();
  return {
    memberId,
    name,
    email,
    passwordHash,
    joinDate,
    monthlyCD: monthlyCD ?? MONTHLY_CD,
    lastPaymentDate: joinDate,
    nextDueDate: new Date(joinDate.getTime() + (30 * 24 * 60 * 60 * 1000)),
    totalCD: JOINING_DEPOSIT,
    loanAmount: 0,
    paidAmount: 0,
    remainingAmount: 0,
    interest: 0,
    monthlyDividend: 0,
    totalDividend: 0,
    rpd25: 0
  };
}

router.post('/addMember', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, monthlyCD } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required.' });
    }

    const currentCount = await Member.countDocuments();
    if (currentCount >= MAX_MEMBERS) {
      return res.status(400).json({ message: 'Maximum 19 members already added.' });
    }

    const nextMemberId = await generateNextMemberCode();
    if (!nextMemberId) {
      return res.status(400).json({ message: 'Member ID pool exhausted.' });
    }

    const rawPassword = password && String(password).trim() ? String(password).trim() : `${nextMemberId}@123`;
    const passwordHash = hashPassword(rawPassword);

    const member = await Member.create(
      buildMemberPayload({
        name,
        email,
        monthlyCD: monthlyCD !== undefined ? Number(monthlyCD) : MONTHLY_CD,
        memberId: nextMemberId,
        passwordHash
      })
    );

    return res.status(201).json({ ...member.toObject(), generatedPassword: rawPassword });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email or member ID already exists.' });
    }
    return res.status(500).json({ message: error.message });
  }
});

router.post('/members', requireAdmin, async (req, res) => {
  try {
    const { name, email, password, monthlyCD } = req.body;

    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required.' });
    }

    const currentCount = await Member.countDocuments();
    if (currentCount >= MAX_MEMBERS) {
      return res.status(400).json({ message: 'Maximum 19 members already added.' });
    }

    const nextMemberId = await generateNextMemberCode();
    if (!nextMemberId) {
      return res.status(400).json({ message: 'Member ID pool exhausted.' });
    }

    const rawPassword = password && String(password).trim() ? String(password).trim() : `${nextMemberId}@123`;
    const passwordHash = hashPassword(rawPassword);

    const member = await Member.create(
      buildMemberPayload({
        name,
        email,
        monthlyCD: monthlyCD !== undefined ? Number(monthlyCD) : MONTHLY_CD,
        memberId: nextMemberId,
        passwordHash
      })
    );

    return res.status(201).json({ ...member.toObject(), generatedPassword: rawPassword });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email or member ID already exists.' });
    }
    return res.status(500).json({ message: error.message });
  }
});

router.get('/members', requireAdmin, async (req, res) => {
  try {
    const members = await Member.find().sort({ createdAt: -1 });
    return res.json(members);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get('/members/:id', requireAdmin, async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }
    return res.json(member);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.put('/members/:id', requireAdmin, async (req, res) => {
  try {
    const { name, email, monthlyCD, password } = req.body;
    const member = await Member.findById(req.params.id).select('+passwordHash');
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }

    if (typeof name === 'string' && name.trim()) {
      member.name = name.trim();
    }

    if (typeof email === 'string' && email.trim()) {
      member.email = email.trim().toLowerCase();
    }

    if (monthlyCD !== undefined) {
      const cd = Number(monthlyCD);
      if (!Number.isFinite(cd) || cd < 0) {
        return res.status(400).json({ message: 'Invalid monthlyCD value.' });
      }
      member.monthlyCD = cd;
    }

    if (typeof password === 'string' && password.trim()) {
      member.passwordHash = hashPassword(password.trim());
    }

    await member.save();
    const safeMember = await Member.findById(member._id);
    return res.json(safeMember);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email already exists.' });
    }
    return res.status(500).json({ message: error.message });
  }
});

router.delete('/members/:id', requireAdmin, async (req, res) => {
  try {
    const member = await Member.findByIdAndDelete(req.params.id);
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }
    return res.json({ message: 'Member removed successfully.' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/api/member/login', async (req, res) => {
  try {
    const { memberId, password } = req.body;
    if (!memberId || !password) {
      return res.status(400).json({ message: 'Member ID and password are required.' });
    }

    const normalizedMemberId = String(memberId).toUpperCase().trim();
    const member = await Member.findOne({ memberId: normalizedMemberId }).select('+passwordHash');
    if (!member || member.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ message: 'Invalid member credentials.' });
    }

    const token = issueMemberToken(normalizedMemberId);
    return res.json({
      token,
      member: {
        memberId: member.memberId,
        name: member.name
      }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/api/member/logout', requireMember, (req, res) => {
  memberSessionStore.delete(req.memberToken);
  return res.json({ message: 'Member logged out successfully.' });
});

router.get('/api/member/:memberId', requireMember, async (req, res) => {
  try {
    const member = await Member.findOne({ memberId: req.params.memberId.toUpperCase() });
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }
    return res.json(member);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get('/api/member/:memberId/records', requireMember, async (req, res) => {
  try {
    const member = await Member.findOne({ memberId: req.params.memberId.toUpperCase() });
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }

    const records = await Transaction.find({ memberId: member._id }).sort({ month: -1, createdAt: -1 });
    return res.json({ member, records });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get('/api/member/ledger/:memberId', requireMember, async (req, res) => {
  try {
    const memberCode = req.params.memberId.toUpperCase();
    const member = await Member.findOne({ memberId: memberCode });
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }

    const ledger = await LedgerTransaction.find({ memberId: member.memberId })
      .sort({ date: -1, createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({ memberId: member.memberId, ledger });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get('/api/member/notifications/:memberId', requireMember, async (req, res) => {
  try {
    const memberCode = req.params.memberId.toUpperCase();
    const member = await Member.findOne({ memberId: memberCode });
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }

    const notifications = await Notification.find({ memberId: member.memberId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.json({ memberId: member.memberId, notifications });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.put('/api/member/notifications/read/:memberId', requireMember, async (req, res) => {
  try {
    const memberCode = req.params.memberId.toUpperCase();
    await Notification.updateMany({ memberId: memberCode, isRead: false }, { $set: { isRead: true } });
    return res.json({ message: 'Notifications marked as read.' });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/api/notifications/create', requireAdmin, async (req, res) => {
  try {
    const { memberId, message, type = 'system' } = req.body;
    if (!memberId || !message) {
      return res.status(400).json({ message: 'memberId and message are required.' });
    }

    const memberCode = String(memberId).toUpperCase().trim();
    const member = await Member.findOne({ memberId: memberCode });
    if (!member) {
      return res.status(404).json({ message: 'Member not found.' });
    }

    const notification = await Notification.create({
      memberId: member.memberId,
      message: String(message).trim(),
      type: String(type).trim().toLowerCase(),
      isRead: false
    });

    return res.status(201).json(notification);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/api/payments/create', requireMember, (req, res) => {
  upload.single('screenshot')(req, res, async (uploadError) => {
    if (uploadError) {
      return res.status(400).json({ message: uploadError.message || 'Invalid file upload.' });
    }

    try {
      const { memberId, amount, type = 'CD' } = req.body;
      const file = req.file;

      if (!memberId || !amount || !file) {
        return res.status(400).json({ message: 'memberId, amount, and screenshot are required.' });
      }

      const normalizedMemberId = String(memberId).toUpperCase().trim();
      if (normalizedMemberId !== req.memberSession.memberId) {
        return res.status(403).json({ message: 'You can submit only your own payment.' });
      }

      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ message: 'Invalid amount.' });
      }

      const payment = await Payment.create({
        memberId: normalizedMemberId,
        amount: Number(numericAmount.toFixed(2)),
        type: String(type).trim().toUpperCase(),
        status: 'pending',
        screenshot: `/uploads/${file.filename}`
      });

      return res.status(201).json(payment);
    } catch (error) {
      return res.status(500).json({ message: error.message });
    }
  });
});

router.get('/api/admin/payments/pending', requireAdmin, async (_req, res) => {
  try {
    const pending = await Payment.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();
    const memberCodes = [...new Set(pending.map((item) => item.memberId))];
    const members = await Member.find({ memberId: { $in: memberCodes } }, { memberId: 1, name: 1, _id: 0 }).lean();
    const memberMap = new Map(members.map((m) => [m.memberId, m.name]));

    const enriched = pending.map((item) => ({
      ...item,
      memberName: memberMap.get(item.memberId) || item.memberId
    }));

    return res.json(enriched);
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/api/admin/payments/approve/:paymentId', requireAdmin, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found.' });
    }
    if (payment.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending payments can be approved.' });
    }

    payment.status = 'approved';
    payment.approvedAt = new Date();
    await payment.save();

    const member = await Member.findOne({ memberId: payment.memberId });
    const balanceAfter = member
      ? Number(((member.totalCD || 0) - (member.remainingAmount || 0)).toFixed(2))
      : 0;

    await LedgerTransaction.create({
      memberId: payment.memberId,
      date: payment.approvedAt,
      type: 'CD_PAYMENT',
      amount: Number(payment.amount.toFixed(2)),
      description: 'Monthly CD payment',
      balanceAfter
    });

    await Notification.create({
      memberId: payment.memberId,
      message: `Your CD payment of ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(payment.amount)} has been approved.`,
      type: 'payment',
      isRead: false
    });

    return res.json({ message: 'Payment approved successfully.', payment });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/api/admin/payments/reject/:paymentId', requireAdmin, async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.paymentId);
    if (!payment) {
      return res.status(404).json({ message: 'Payment not found.' });
    }
    if (payment.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending payments can be rejected.' });
    }

    payment.status = 'rejected';
    payment.approvedAt = null;
    await payment.save();

    return res.json({ message: 'Payment rejected successfully.', payment });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
