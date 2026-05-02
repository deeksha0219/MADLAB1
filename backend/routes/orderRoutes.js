const express = require("express");
const router = express.Router();

let orders = [];

// GET ALL ORDERS
router.get("/", (req, res) => {
  res.json(orders);
});

// PLACE ORDER (save cart as order)
router.post("/place", (req, res) => {
  const { items, total } = req.body;
  const order = {
    id: Date.now().toString(),
    items,
    total,
    placedAt: new Date().toLocaleString(),
  };
  orders.unshift(order); // newest first
  res.json({ success: true, order });
});

// CLEAR ORDERS
router.delete("/clear", (req, res) => {
  orders = [];
  res.json({ message: "Orders cleared" });
});

module.exports = router;