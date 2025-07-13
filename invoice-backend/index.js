const express = require('express');
const mysql = require('mysql2');

const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'CHAmmulu@770',  
  database: 'invoice_db'
});

db.connect(err => {
  if (err) {
    console.error('MySQL connection error:', err);
    return;
  }
  console.log('Connected Successfully to MySQL database.');
});

app.get('/', (req, res) => {
  res.send('Invoice backend is running.');
});

app.get('/invoices', (req, res) => {
  db.query('SELECT * FROM invoices', (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

app.post("/api/invoices", (req, res) => {
  const { clientName, clientEmail, invoiceNumber, issueDate, dueDate, items } = req.body;

  const totalAmount = items.reduce((sum, item) => {
    return sum + item.quantity * item.unitPrice;
  }, 0);

  const status = "Pending"; 
  const role = "editor"; 

  const insertInvoiceQuery = `
    INSERT INTO invoices (client_name, client_email, invoice_number, issue_date, due_date, amount, status, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    insertInvoiceQuery,
    [clientName, clientEmail, invoiceNumber, issueDate, dueDate, totalAmount, status, role],
    (err, result) => {
      if (err) {
        console.error("Error inserting invoice:", err);
        return res.status(500).json({ error: err.message });
      }

      const invoiceId = result.insertId;

      const itemValues = items.map(item => [
        invoiceId,
        item.description,
        item.quantity,
        item.unitPrice
      ]);

      const insertItemsQuery = `
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price)
        VALUES ?
      `;

      db.query(insertItemsQuery, [itemValues], (err2) => {
        if (err2) {
          console.error("Error inserting invoice items:", err2);
          return res.status(500).json({ error: err2.message });
        }

        res.status(201).json({ message: "✅ Invoice created successfully", invoiceId });
      });
    }
  );
});


app.put('/invoices/:id', (req, res) => {
  const { id } = req.params;
  const { client_name, client_email, invoice_number, issue_date, due_date } = req.body;

  const sql = 'UPDATE invoices SET client_name=?, client_email=?, invoice_number=?, issue_date=?, due_date=? WHERE id=?';
  db.query(sql, [client_name, client_email, invoice_number, issue_date, due_date, id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Invoice updated' });
  });
});

app.delete('/invoices/:id', (req, res) => {
  const { id } = req.params;
  db.query('DELETE FROM invoices WHERE id=?', [id], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Invoice deleted' });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
app.get('/invoices/:id', (req, res) => {
  const invoiceId = req.params.id;

  const query = `
    SELECT i.*, ii.description, ii.quantity, ii.unit_price
    FROM invoices i
    LEFT JOIN invoice_items ii ON i.id = ii.invoice_id
    WHERE i.id = ?
  `;

  db.query(query, [invoiceId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: 'Invoice not found' });

    const invoice = {
      id: results[0].id,
      client_name: results[0].client_name,
      client_email: results[0].client_email,
      invoice_number: results[0].invoice_number,
      issue_date: results[0].issue_date,
      due_date: results[0].due_date,
      items: []
    };

    results.forEach(row => {
      if (row.description) {
        invoice.items.push({
          description: row.description,
          quantity: row.quantity,
          unit_price: row.unit_price,
          total: row.quantity * row.unit_price
        });
      }
    });

    res.json(invoice);
  });
});

app.get('/invoices', (req, res) => {
  const sql = 'SELECT * FROM invoices';
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching invoices:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
    res.json(results);
  });
});

app.get('/invoices/:id', (req, res) => {
  const { id } = req.params;
  const sql = 'SELECT * FROM invoices WHERE id = ?';
  db.query(sql, [id], (err, results) => {
    if (err) {
      console.error("Error fetching invoice:", err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    res.json(results[0]);
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;

  db.query('SELECT * FROM users WHERE email = ? AND password = ?', [email, password], (err, results) => {
    if (err) return res.status(500).json({ error: 'Server error' });

    if (results.length > 0) {
      const user = results[0];
      res.json({
        id: user.id,
        email: user.email,
        role: user.role, 
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
});
