const express = require('express');
const crypto = require('crypto');
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');

const router = express.Router();
const requireAdmin = (req, res, next) => req.app.locals.requireAdmin(req, res, next);

const MAX_MEMBERS = 19;
const JOINING_DEPOSIT = 10000;
const MONTHLY_CD = 5000;
const memberSessionStore = new Map();

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

module.exports = router;
