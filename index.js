require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;

// ✅ MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect(err => {
  if (err) {
    console.error('❌ MySQL error:', err);
    return;
  }
  console.log('✅ Connected to MySQL');
});

// ✅ JWT Middleware
function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token missing' });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded;
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// 🔐 Register
app.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  db.query('SELECT * FROM users WHERE email = ?', [email], async (err, results) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (results.length > 0) return res.status(409).json({ error: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const role = email.endsWith('@admin.com') ? 'admin' : email.includes('billing') ? 'editor' : 'viewer';

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

// ✅ Create Invoice
app.post('/api/invoices', authenticateToken, (req, res) => {
  const { client_name, client_email, invoice_date, due_date, items } = req.body;

  if (!client_name || !client_email || !invoice_date || !due_date || !items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  db.query(
    'INSERT INTO invoices (client_name, client_email, invoice_date, due_date) VALUES (?, ?, ?, ?)',
    [client_name, client_email, invoice_date, due_date],
    (err, result) => {
      if (err) return res.status(500).json({ error: 'Failed to insert invoice' });

      const invoiceId = result.insertId;
      const itemValues = items.map(item => [invoiceId, item.description, item.quantity, item.unit_price]);

      db.query(
        'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price) VALUES ?',
        [itemValues],
        (err2) => {
          if (err2) return res.status(500).json({ error: 'Failed to insert invoice items' });
          res.status(201).json({ message: 'Invoice created successfully', invoice_id: invoiceId });
        }
      );
    }
  );
});

// ✅ Get All Invoices
app.get('/api/invoices', authenticateToken, (req, res) => {
  const user = req.user;

  let sql = `
    SELECT invoices.*, 
           IFNULL(SUM(invoice_items.unit_price * invoice_items.quantity), 0) AS total_amount,
           CASE 
             WHEN invoices.status = 'Paid' THEN 'Paid'
             WHEN invoices.due_date < CURDATE() THEN 'Overdue'
             ELSE 'Pending'
           END AS status
    FROM invoices
    LEFT JOIN invoice_items ON invoices.id = invoice_items.invoice_id
  `;

  const values = [];
  if (user.role === 'viewer') {
    sql += ' WHERE invoices.client_email = ?';
    values.push(user.email);
  }

  sql += ' GROUP BY invoices.id';

  db.query(sql, values, (err, results) => {
    if (err) return res.status(500).json({ error: 'Internal Server Error' });
    res.json(results);
  });
});

// ✅ Get Invoice by ID
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
      id,
      client_name: results[0].client_name,
      client_email: results[0].client_email,
      due_date: results[0].due_date,
      items: results
        .filter(row => row.description)
        .map(row => ({
          description: row.description,
          quantity: row.quantity,
          unit_price: row.unit_price
        }))
    };

    res.json(invoice);
  });
});

// ✅ Update Invoice
// ✅ Update Invoice
app.put('/api/invoices/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { client_name, client_email, due_date, issue_date, status, items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Invoice items are required' });
  }

  // Only update fields that were provided
  const fields = [];
  const values = [];

  if (client_name) {
    fields.push('client_name = ?');
    values.push(client_name);
  }

  if (client_email) {
    fields.push('client_email = ?');
    values.push(client_email);
  }

  if (due_date) {
    fields.push('due_date = ?');
    values.push(due_date);
  }

  if (issue_date) {
    fields.push('invoice_date = ?');
    values.push(issue_date);
  }

  if (status) {
    fields.push('status = ?');
    values.push(status);
  }

  values.push(id); // For WHERE clause

  const updateQuery = `UPDATE invoices SET ${fields.join(', ')} WHERE id = ?`;

  db.query(updateQuery, values, (err) => {
    if (err) return res.status(500).json({ error: 'Failed to update invoice' });

    // Remove old items
    db.query('DELETE FROM invoice_items WHERE invoice_id = ?', [id], (err2) => {
      if (err2) return res.status(500).json({ error: 'Failed to delete old items' });

      const itemValues = items.map(item => [id, item.description, item.quantity, item.unit_price]);
      db.query(
        'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price) VALUES ?',
        [itemValues],
        (err3) => {
          if (err3) return res.status(500).json({ error: 'Failed to insert new items' });
          res.json({ message: '✅ Invoice updated successfully' });
        }
      );
    });
  });
});


// ✅ Delete Invoice
app.delete('/api/invoices/:id', authenticateToken, (req, res) => {
  db.query('DELETE FROM invoices WHERE id=?', [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Invoice deleted successfully' });
  });
});

// ✅ Fallback route (must be last!)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ✅ Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
