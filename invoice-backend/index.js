const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require("nodemailer");

const app = express();
const PORT = 3000;
const SECRET_KEY = 'ChakravaramSuperSecretKey@2005';

// Middleware
app.use(cors());
app.use(bodyParser.json());

// DB Connection
const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'CHAmmulu@770',
  database: 'invoice_db',
});

db.connect(err => {
  if (err) {
    console.error('❌ MySQL error:', err);
    return;
  }
  console.log('✅ Connected to MySQL database');
});

const dbPromise = db.promise();


// JWT Middleware
function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token missing' });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Home
app.get('/', (req, res) => {
  res.send('Invoice backend is running');
});

// 🔐 Register
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    if (results.length > 0) return res.status(409).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    let role = 'viewer';
    if (email.endsWith('@admin.com')) role = 'admin';
    else if (email.includes('billing')) role = 'editor';

    db.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, role],
      (err) => {
        if (err) return res.status(500).json({ error: 'Registration failed' });
        res.json({ message: 'Registered successfully' });
      }
    );
  });
});

// 🔐 Login
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err || results.length === 0) return res.status(401).json({ error: 'User not found' });

    const user = results[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      SECRET_KEY,
      { expiresIn: '1h' }
    );

    res.json({ token, role: user.role });
  });
});


// 🔐 Create Invoice
app.post('/api/invoices', authenticateToken, (req, res) => {
  const { clientName, invoiceNumber, issueDate, dueDate, items } = req.body;
  const totalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const status = 'Pending';

  const emailFromToken = req.user.email;
  const roleFromToken = req.user.role;
  const clientEmail = roleFromToken === 'viewer' ? emailFromToken : req.body.clientEmail;
  const role = roleFromToken === 'viewer' ? 'viewer' : 'editor';

  const insertInvoiceQuery = `
    INSERT INTO invoices (client_name, client_email, invoice_number, issue_date, due_date, amount, status, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(insertInvoiceQuery, [clientName, clientEmail, invoiceNumber, issueDate, dueDate, totalAmount, status, role], (err, result) => {
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
  });
});

// 🔐 Get All Invoices
app.get('/api/invoices', authenticateToken, (req, res) => {
  const user = req.user;
  let sql = `
    SELECT invoices.*, 
           IFNULL(SUM(invoice_items.unit_price * invoice_items.quantity), 0) AS total_amount
    FROM invoices
    LEFT JOIN invoice_items ON invoices.id = invoice_items.invoice_id
  `;

  const values = [];
  if (user.role === 'viewer') {
    sql += ` WHERE invoices.client_email = ?`;
    values.push(user.email);
  }

  sql += ` GROUP BY invoices.id`;

  db.query(sql, values, (err, results) => {
    if (err) return res.status(500).json({ error: 'Internal Server Error' });
    res.json(results);
  });
});

// 🔐 Get Invoice by ID
app.get('/api/invoices/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const query = `
    SELECT i.*, ii.description, ii.quantity, ii.unit_price
    FROM invoices i
    LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
    WHERE i.id = ?
  `;

  db.query(query, [id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = {
      ...results[0],
      items: results.map(row => ({
        description: row.description,
        quantity: row.quantity,
        unit_price: row.unit_price,
        total: row.quantity * row.unit_price
      })).filter(item => item.description)
    };

    res.json(invoice);
  });
});

// 🔐 Update Invoice
app.put('/api/invoices/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { client_name, client_email, issue_date, due_date, status } = req.body;

  db.query(
    `UPDATE invoices SET client_name=?, client_email=?, issue_date=?, due_date=?, status=? WHERE id=?`,
    [client_name, client_email, issue_date, due_date, status, id],
    (err) => {
      if (err) return res.status(500).json({ error: 'Update failed' });
      res.json({ message: '✅ Invoice updated successfully' });
    }
  );
});

// 🔐 Mark as Paid
app.patch("/api/invoices/:id/pay", authenticateToken, (req, res) => {
  db.query("UPDATE invoices SET status = 'Paid' WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Failed to update status" });
    res.json({ message: "✅ Invoice marked as Paid" });
  });
});

// 🔐 Delete Invoice
app.delete('/api/invoices/:id', authenticateToken, (req, res) => {
  db.query('DELETE FROM invoices WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: '✅ Invoice deleted successfully' });
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
