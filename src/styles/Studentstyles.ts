import { StyleSheet } from "react-native";
const ORANGE = "#DF401C";

export const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F63204",
    alignItems: "center",
    justifyContent: "center",  // ✅ centers everything
  },
  logoContainer: {
    alignItems: "center",
    marginBottom: 20,          // ✅ space between logo and tagline
  },
  logo: {
    width: 220,
    height: 220,
  },
  tagline: {
    fontSize: 24,
    color: "white",
    fontWeight: "bold",
    marginTop: 10,
  },
  bottomContainer: {
    position: "absolute",
    bottom: 60,
    alignItems: "center",
  },
  foodEmojis: {
    fontSize: 32,
  },
  loading: {
    fontSize: 18,
    color: "white",
    marginTop: 8,
  },
});



const GREY = "#D9D9D9";

export const loginStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 20,
  },

  logo: {
    width: 250,
    height: 100,
    resizeMode: "contain"
  },

  welcome: {
    fontSize: 22,
    marginTop: 20,
    fontWeight: "500"
  },

  subText: {
    fontSize: 18,
    marginTop: 5
  },

  phoneContainer: {
  flexDirection: "row",
  width: "115%",
  backgroundColor: GREY,
  marginTop: 50,
  borderRadius: 14,
  paddingHorizontal: 3,
  height: 66,
  alignItems: "center"
},

  countryCode: {
    fontSize: 12
  },

  phoneInput: {
    flex: 1,
    padding: 10,
    fontSize: 12
  },

  otpButton: {
    minWidth: 9,
    backgroundColor: ORANGE,
    paddingVertical: 22,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginLeft: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  otpButtonText: {
    color: "#FFF",
    fontWeight: "600",
    fontSize: 14,
  },

  otpInput: {
  width: "115%",
  backgroundColor: GREY,
  marginTop: 25,
  fontSize: 12,
  borderRadius: 14,
  paddingHorizontal: 14,
  height: 66,
},

  resendText: {
    fontSize: 14,
  },

  resend: {
    color: "#E53935",
    fontWeight: "500",
    fontSize: 16,
    lineHeight: 50,
  },

  verifyButton: {
    backgroundColor: ORANGE,
    width: "60%",
    height: 55,
    marginTop: 30,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center"
  },

  verifyButtonText: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "700"
  },

  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    paddingTop: 20,
    paddingBottom: 30,
    paddingHorizontal: 20,
  },

  firstTime: {
    marginTop: 40,
    fontSize: 16
  },

  collegeID: {
    marginTop: 8,
    fontSize: 18,
    color: ORANGE,
    fontWeight: "600",
    textDecorationLine: "underline"
  },

  roleContainer: {
    flexDirection: "row",
    alignSelf: "center",
    marginTop: 35,
  },
});

export const home = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF"
  },

  // HEADER
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    alignItems: "center"
  },

  location: {
    fontSize: 12,
    color: "#555"
  },

  place: {
    color: ORANGE,
    fontWeight: "bold",
    fontSize: 14
  },

  // SEARCH
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    marginTop: 10
  },

  searchBox: {
    flex: 1,
    backgroundColor: "#E6E6E6",
    borderRadius: 30,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 15,
    height: 45
  },

  // CATEGORY GRID
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-around",
    marginTop: 15
  },

  category: {
    width: "30%",
    alignItems: "center",
    marginBottom: 20
  },

  catImage: {
    width: 70,
    height: 70,
    borderRadius: 15,
    borderWidth: 4,
    borderColor: ORANGE
  },

  catText: {
    marginTop: 5,
    fontSize: 12,
    fontStyle: "italic",
    textAlign: "center"
  },

  // SECTION TITLE
  section: {
    marginLeft: 15,
    marginBottom: 10,
    fontWeight: "bold",
    fontSize: 16
  },

  // FOOD CARD
  card: {
    flexDirection: "row",
    backgroundColor: "#fff",
    marginHorizontal: 15,
    marginBottom: 15,
    padding: 15,
    borderRadius: 15,
    elevation: 3 // android shadow
  },

  title: {
    fontWeight: "bold",
    fontSize: 16
  },

  desc: {
    fontSize: 12,
    marginVertical: 5,
    color: "#555"
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "center"
  },

  qtyBtn: {
    backgroundColor: ORANGE,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 5
  },

  price: {
    marginHorizontal: 10,
    fontWeight: "bold"
  },

  foodBox: {
    alignItems: "center",
    marginLeft: 10
  },

  foodImg: {
    width: 80,
    height: 60,
    borderRadius: 10
  },

  addBtn: {
    backgroundColor: ORANGE,
    paddingHorizontal: 15,
    paddingVertical: 5,
    borderRadius: 5,
    marginTop: 5
  },

  addText: {
    color: "#000",
    fontWeight: "bold"
  },

  logoCenter: {
  width: 150,
  height: 50,
  resizeMode: "contain",
  marginLeft: -50,
},
});


export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 15
  },
  header: {
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 15
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f2f2f2",
    padding: 12,
    borderRadius: 12,
    marginBottom: 15
  },
  img: {
    width: 60,
    height: 60,
    marginRight: 10
  },
  title: {
    fontSize: 14,
    fontWeight: "500"
  },
  price: {
    fontWeight: "600",
    textAlign: "right",
    marginBottom: 8
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ORANGE,
    borderRadius: 8
  },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 4
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold"
  },
  qty: {
    color: "#fff",
    paddingHorizontal: 10
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
    marginBottom: 20
  },
  totalText: {
    fontSize: 16
  },
  totalPrice: {
    fontSize: 16,
    fontWeight: "600"
  },
  orderBtn: {
    backgroundColor: ORANGE,
    padding: 15,
    borderRadius: 10,
    alignItems: "center"
  },
  orderText: {
    color: "#000",
    fontWeight: "600"
  }
});

export const categoryStyles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 15
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "bold"
  },
  card: {
    marginHorizontal: 15,
    marginBottom: 25
  },
  image: {
    width: "100%",
    height: 200,
    borderRadius: 15,
    resizeMode: "contain"
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10
  },
  title: {
    fontSize: 16,
    fontWeight: "bold"
  },
  price: {
    fontSize: 16,
    fontWeight: "bold"
  },
  desc: {
    marginTop: 5,
    color: "#555"
  },
  button: {
    backgroundColor: "#DF401C",
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    alignItems: "center"
  },
  buttonText: {
    fontWeight: "bold",
    color: "#000"
  },

  cartBar: {
  position: "absolute",
  bottom: 12,
  left: 12,
  right: 12,
  height: 48,
  backgroundColor: "#DF401C",
  borderRadius: 10,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: 20,
  elevation: 6,
  shadowOpacity: 0.2,
  shadowRadius: 5,
  shadowOffset: {
    width: 0,
    height: 2,
  },
},

cartItemText: {
  color: "#000",
  fontSize: 15,
  fontWeight: "600",
},

viewCartContainer: {
  flexDirection: "row",
  alignItems: "center",
},

viewCartText: {
  color: "#000",
  fontSize: 15,
  fontWeight: "600",
},
});

export const cartStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f2f2",
    padding: 15,
  },
  header: {
    fontSize: 18,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  pickup: {
    backgroundColor: "#e6e6e6",
    padding: 20,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  card: {
    flexDirection: "row",
    backgroundColor: "#e6e6e6",
    padding: 30,
    borderRadius: 12,
    marginBottom: 15,
  },
  image: {
    width: 100,
    height: 100,
    marginRight: 10,
    resizeMode: "contain",
  },
  name: {
    fontSize: 16,
    fontWeight: "bold",
  },
  price: {
    fontSize: 14,
    marginVertical: 5,
  },
  counter: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ff4d1a",
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  qty: {
    color: "#fff",
    marginHorizontal: 10,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 15,
  },
  totalText: {
    fontSize: 16,
  },
  totalPrice: {
    fontSize: 16,
    fontWeight: "bold",
  },
  checkoutBtn: {
    backgroundColor: "#ff4d1a",
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
  },
  checkoutText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },

    lockButton: {
  backgroundColor: "#e64a19",
  padding: 15,
  borderRadius: 10,
  alignItems: "center",
  marginTop: 20,
},

lockText: {
  color: "#fff",
  fontSize: 16,
  fontWeight: "bold",
},
});


export const paymentstyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f2f2f2",
    padding: 20,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },

  back: {
    fontSize: 24,
    marginRight: 15,
    color: "#000",
  },

  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#000",
  },

  section: {
    marginTop: 16,
    marginBottom: 10,
    color: "#999",
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 14,
    marginBottom: 10,
    elevation: 1,
  },

  icon: {
    width: 36,
    height: 36,
    marginRight: 14,
    resizeMode: "contain",
  },

  text: {
    fontSize: 16,
    fontWeight: "500",
    color: "#000",
  },

  button: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: "#e64a19",
    padding: 16,
    borderRadius: 14,
    alignItems: "center",
  },

  buttonText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 16,
  },
});

export const orderstyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    padding: 20,
  },
  backArrow: {
    fontSize: 24,
    marginBottom: 10,
  },
  header: {
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 20,
  },
  imageContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 30,
  },
  foodImage: {
    width: 350,
    height: 350,
    resizeMode: "contain",
    alignSelf: "center",
  },
  checkCircle: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#E8F5E9",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    textAlign: "center",
    fontSize: 22,
    fontWeight: "bold",
    marginTop: 10,
  },
  subtitle: {
    textAlign: "center",
    fontSize: 14,
    color: "gray",
    marginTop: 5,
  },
  button: {
    marginTop: 40,
    backgroundColor: "#E53935",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});


export const Accstyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    paddingTop: 30,
  },

  logoImage: {
  width: 250,       
  height: 70,
  resizeMode: "contain",
  alignSelf: "center",
  marginTop: 20,
  marginBottom: 30,
},

  welcome: {
    marginTop: 20,
    fontSize: 18,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 20,
  },

  card: {
    width: "90%",
    backgroundColor: "#e53915",
    borderRadius: 20,
    paddingTop: 25,
    paddingBottom: 25,
    paddingVertical: 20,
    paddingHorizontal: 25,
    alignItems: "stretch",
  },

  cardTitle: {
    fontSize: 25,
    color: "black",
    marginTop: 10,
    marginBottom: 20,
    textAlign: "center",
    alignSelf: "center",
  },

  input: {
    width: "100%",
    backgroundColor: "#d9d9d9",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 15,
    marginBottom: 18,
    fontSize: 14,
  },

  button: {
    backgroundColor: "#EB7018",
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 12,
    marginTop: 10,
    elevation: 5,
    alignItems: "center",
    alignSelf: "center",
  },

  buttonText: {
    fontWeight: "bold",
    fontSize: 16,
    color: "black",
  },

  footer: {
    marginTop: 20,
    fontSize: 14,
  },

  login: {
    color: "#e53915",
    fontWeight: "bold",
  },
});

export const orderHistoryStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 25,
    paddingTop: 35,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },

  backBtn: {
  fontSize: 22,
  marginRight: 20,
  marginTop: 10,
},

  headerTitle: {
    fontSize: 18,
    fontWeight: "bold",
  },

  orderCard: {
    backgroundColor: "#f2f2f2",
    borderRadius: 12,
    padding: 12,
    marginBottom: 15,
  },

  orderDate: {
    color: "gray",
    fontSize: 12,
    marginBottom: 8,
  },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },

  itemImage: {
    width: 70,
    height: 70,
    borderRadius: 10,
    marginRight: 12,
    resizeMode: "contain",
  },

  itemDetails: {
    flex: 1,
  },

  itemNameRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  itemName: {
    fontWeight: "bold",
    fontSize: 15,
  },

  itemPrice: {
    fontWeight: "bold",
    fontSize: 15,
  },

  bottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 5,
  },

  totalText: {
    fontWeight: "bold",
    fontSize: 15,
  },

  reorderBtn: {
    backgroundColor: "#E53010",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },

  reorderIcon: {
    fontSize: 16,
    color: "#fff",
  },

  reorderText: {
    color: "#fff",
    fontWeight: "bold",
  },

  emptyText: {
    textAlign: "center",
    color: "gray",
    marginTop: 40,
    fontSize: 16,
  },
});
