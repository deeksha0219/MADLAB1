const express = require("express");
const cors = require("cors");
const app = express();

app.use(cors());
app.use(express.json());

// OTP store
let otpStore = {};

// ✅ TEST ROUTE
app.get("/", (req, res) => {
  res.send("Server is running 🚀");
});

// ✅ SEND OTP
app.post("/send-otp", (req, res) => {
  const { phone } = req.body;
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[phone] = otp;
  console.log(`OTP for ${phone}: ${otp}`);
  res.json({ success: true, otp: otp });
});

// ✅ VERIFY OTP
app.post("/verify-otp", (req, res) => {
  const { phone, otp } = req.body;
  if (String(otpStore[phone]) === String(otp)) {
    delete otpStore[phone];
    res.json({ success: true });
  } else {
    res.json({ success: false, message: "Wrong OTP" });
  }
});

// ✅ CART ROUTES — ADD THIS
const cartRoutes = require("./routes/cartRoutes");
app.use("/api/cart", cartRoutes);

// ✅ START SERVER
app.listen(5000, () => {
  console.log("Server running on port 5000 🚀");
});

// Orderhistory
const orderRoutes = require("./routes/orderRoutes");
app.use("/api/orders", orderRoutes);

