// script.js

document.getElementById('invoiceForm').addEventListener('submit', function(e) {
  e.preventDefault(); // prevent form's default submit

  // Collect basic invoice info
  const client_name = this.clientName.value.trim();
  const client_email = this.clientEmail.value.trim();
  const invoice_number = this.invoiceNumber.value.trim();
  const issue_date = this.issueDate.value;
  const due_date = this.dueDate.value;

  // Collect invoice items
  const descriptions = Array.from(document.getElementsByName('description[]')).map(input => input.value.trim());
  const quantities = Array.from(document.getElementsByName('quantity[]')).map(input => parseInt(input.value));
  const unit_prices = Array.from(document.getElementsByName('unitPrice[]')).map(input => parseFloat(input.value));

  // Build items array
  const items = [];
  for (let i = 0; i < descriptions.length; i++) {
    if (descriptions[i] && quantities[i] && unit_prices[i]) {
      items.push({
        description: descriptions[i],
        quantity: quantities[i],
        unit_price: unit_prices[i]
      });
    }
  }

  // Prepare payload JSON
  const payload = {
    client_name,
    client_email,
    invoice_number,
    issue_date,
    due_date,
    items
  };

  // Send POST request to backend API
  fetch('http://127.0.0.1:3000/invoices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (!res.ok) throw new Error('Network response was not ok');
    return res.json();
  })
  .then(data => {
    alert('Invoice saved successfully! Invoice ID: ' + data.invoiceId);
    // Optionally, reset the form
    this.reset();
    // Optionally, clear extra item rows except first
    const itemsContainer = document.getElementById('itemsContainer');
    while(itemsContainer.children.length > 1) {
      itemsContainer.removeChild(itemsContainer.lastChild);
    }
  })
  .catch(err => {
    alert('Error saving invoice: ' + err.message);
  });
});

// Function to add new invoice item row
function addItem() {
  const container = document.getElementById('itemsContainer');
  const newItem = document.createElement('div');
  newItem.classList.add('item-row');
  newItem.innerHTML = `
    <input type="text" placeholder="Description" name="description[]" required />
    <input type="number" placeholder="Qty" name="quantity[]" min="1" required />
    <input type="number" placeholder="Unit Price" name="unitPrice[]" step="0.01" required />
  `;
  container.appendChild(newItem);
}

function editInvoice(id) {
  window.location.href = `add-invoice.html?id=${id}`;
}


