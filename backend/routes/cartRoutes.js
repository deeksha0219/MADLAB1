const express = require("express");
const router = express.Router();

let cart = [];

// GET CART
router.get("/", (req, res) => {
  res.json(cart);
});

// ADD TO CART (by id)
router.post("/add", (req, res) => {
  const { name, price } = req.body;

  const existing = cart.find(i => i.name === name);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: Date.now().toString(),
      name,
      price,
      quantity: 1
    });
  }
  res.json(cart);
});

// INCREASE QTY by id
router.post("/increase/:id", (req, res) => {
  const item = cart.find(i => i.id === req.params.id);
  if (item) item.quantity += 1;
  res.json(cart);
});

// DECREASE QTY by id
router.post("/decrease/:id", (req, res) => {
  const item = cart.find(i => i.id === req.params.id);
  if (item) {
    item.quantity -= 1;
    if (item.quantity <= 0) {
      cart = cart.filter(i => i.id !== req.params.id);
    }
  }
  res.json(cart);
});

// ✅ DECREASE QTY
router.post("/decrease/:id", (req, res) => {
  const itemIndex = cart.findIndex(i => i.id === req.params.id);
  if (itemIndex !== -1) {
    cart[itemIndex].quantity -= 1;
    if (cart[itemIndex].quantity <= 0) {
      cart.splice(itemIndex, 1); // ✅ properly remove item
    }
  }
  res.json(cart);
});

// REMOVE by id (from CartScreen)
router.delete("/remove/:id", (req, res) => {
  cart = cart.filter(i => i.id !== req.params.id);
  res.json(cart);
});

// REMOVE by name (from HomeScreen)
router.delete("/remove-by-name", (req, res) => {
  const { name } = req.body;
  cart = cart.filter(i => i.name !== name);
  res.json(cart);
});

// CLEAR CART
router.delete("/clear", (req, res) => {
  cart = [];
  res.json({ message: "Cart cleared" });
});

module.exports = router;