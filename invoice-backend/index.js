const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = 3000;
const SECRET_KEY = 'ChakravaramSuperSecretKey@2005';

const authenticateToken = require('./Middleware/authMiddleware');


// Middlewares
app.use(cors());
app.use(bodyParser.json());

// MySQL Connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'CHAmmulu@770',
  database: 'invoice_db',
});

db.connect(err => {
  if (err) {
    console.error('MySQL connection error:', err);
    return;
  }
  console.log('✅ Connected to MySQL database.');
});

// JWT Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token missing' });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Routes
app.get('/', (req, res) => {
  res.send('Invoice backend is running.');
});

// 🔐 Register
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    if (results.length > 0) {
      return res.status(409).json({ error: 'User already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // Auto-assign role
    let role = 'viewer';
    if (email.endsWith('@admin.com')) role = 'admin';
    else if (email.includes('billing')) role = 'editor';

    db.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, role],
      (err, result) => {
        if (err) return res.status(500).json({ error: 'Registration failed' });
        res.status(200).json({ message: 'Registered successfully' });
      }
    );
  });
});



// 🔐 Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err || results.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      SECRET_KEY,
      { expiresIn: '1h' }
    );

    // 🔥 Important: Send role in response
    res.json({ token, role: user.role });
  });
});


// 🔐 Create Invoice (Protected)
app.post('/api/invoices', authMiddleware, (req, res) => {
  const { clientName, clientEmail, invoiceNumber, issueDate, dueDate, items } = req.body;

  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const status = 'Pending';
  const role = 'editor';

  const insertInvoiceQuery = `
    INSERT INTO invoices (client_name, client_email, invoice_number, issue_date, due_date, amount, status, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(insertInvoiceQuery,
    [clientName, clientEmail, invoiceNumber, issueDate, dueDate, totalAmount, status, role],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });

      const invoiceId = result.insertId;
      const itemValues = items.map(item => [invoiceId, item.description, item.quantity, item.unitPrice]);

      const insertItemsQuery = `
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price)
        VALUES ?
      `;

      db.query(insertItemsQuery, [itemValues], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.status(201).json({ message: '✅ Invoice created successfully', invoiceId });
      });
    }
  );
});

// 🔐 Get All Invoices (Protected)
app.get('/api/invoices', authMiddleware, (req, res) => {
  db.query('SELECT * FROM invoices', (err, results) => {
    if (err) return res.status(500).json({ error: 'Internal Server Error' });
    res.json(results);
  });
});


// 🔐 Get Invoice by ID (Protected)
app.get('/api/invoices/:id', authMiddleware, (req, res) => {
  const { id } = req.params;

  const query = `
    SELECT i.id, i.client_name, i.client_email, i.invoice_number,
           i.issue_date, i.due_date, i.status, i.amount, i.paid,
           ii.description, ii.quantity, ii.unit_price
    FROM invoices i
    LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
    WHERE i.id = ?
  `;

  db.query(query, [id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });

    // ✅ ✅ Step 3: Debug log here
    console.log("📦 Results from DB for invoice id", id, ":", results);

    if (results.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = {
      id: results[0].id,
      client_name: results[0].client_name,
      client_email: results[0].client_email,
      invoice_number: results[0].invoice_number,
      issue_date: results[0].issue_date,
      due_date: results[0].due_date,
      amount: results[0].amount,
      status: results[0].status || 'Pending',
      paid: results[0].paid || false,
      items: []
    };

    for (const row of results) {
      if (row.description) {
        invoice.items.push({
          description: row.description,
          quantity: row.quantity,
          unit_price: row.unit_price,
          total: row.quantity * row.unit_price
        });
      }
    }

    res.json(invoice);
  });
});



// 🔐 Update Invoice (Protected)
app.put('/api/invoices/:id', authMiddleware, (req, res) => {
  console.log("🔍 Fetching invoice ID:", req.params.id);
  const { id } = req.params;
  const { client_name, client_email, invoice_number, issue_date, due_date } = req.body;

  const sql = `
    UPDATE invoices 
    SET client_name=?, client_email=?, invoice_number=?, issue_date=?, due_date=? 
    WHERE id=?
  `;

  db.query(sql, [client_name, client_email, invoice_number, issue_date, due_date, id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Invoice updated successfully' });
  });
});


// 🔐 Delete Invoice (Protected)
app.delete('/api/invoices/:id', authMiddleware, (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM invoices WHERE id=?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Invoice deleted successfully' });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
