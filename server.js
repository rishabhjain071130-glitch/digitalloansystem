const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const crypto = require('crypto');

const memberRoutes = require('./routes/memberRoutes');
const loanRoutes = require('./routes/loanRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://admin:admin123@cluster0.8noytax.mongodb.net/societyDB?retryWrites=true&w=majority';
const ADMIN_EMAIL = 'admin@society.local';
const ADMIN_PASSWORD = 'Admin@123';

const adminSessionStore = new Map();

const adminSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, required: true },
    passwordHash: { type: String, required: true },
    name: { type: String, default: 'System Admin' }
  },
  { timestamps: true }
);

const Admin = mongoose.models.Admin || mongoose.model('Admin', adminSchema);

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function issueAdminToken(adminId) {
  const token = crypto.randomBytes(32).toString('hex');
  adminSessionStore.set(token, { adminId, createdAt: Date.now() });
  return token;
}

function readTokenFromRequest(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

function requireAdmin(req, res, next) {
  const token = readTokenFromRequest(req);
  if (!token || !adminSessionStore.has(token)) {
    return res.status(401).json({ message: 'Unauthorized. Admin login required.' });
  }
  req.adminSession = adminSessionStore.get(token);
  return next();
}

app.locals.requireAdmin = requireAdmin;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (!admin || admin.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = issueAdminToken(String(admin._id));
    return res.json({
      token,
      admin: {
        email: admin.email,
        name: admin.name
      }
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.get('/admin/session', requireAdmin, async (req, res) => {
  try {
    const admin = await Admin.findById(req.adminSession.adminId);
    if (!admin) {
      return res.status(401).json({ message: 'Session invalid.' });
    }
    return res.json({ email: admin.email, name: admin.name });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

app.post('/admin/logout', requireAdmin, (req, res) => {
  const token = readTokenFromRequest(req);
  if (token) {
    adminSessionStore.delete(token);
  }
  return res.json({ message: 'Logged out successfully.' });
});

app.use('/', memberRoutes);
app.use('/', loanRoutes);
app.use('/', dashboardRoutes);

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    const existingAdmin = await Admin.findOne({ email: ADMIN_EMAIL });
    if (!existingAdmin) {
      await Admin.create({
        email: ADMIN_EMAIL,
        passwordHash: hashPassword(ADMIN_PASSWORD),
        name: 'Primary Admin'
      });
      console.log('Default admin created: admin@society.local / Admin@123');
    }

    console.log('MongoDB connected:', MONGO_URI);
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('MongoDB connection failed:', error.message);
    process.exit(1);
  });
