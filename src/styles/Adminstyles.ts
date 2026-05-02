import { StyleSheet } from "react-native";
const ORANGE = "#DF401C";


export const Homestyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#EDEDED",
  },

  header: {
  backgroundColor: "#E23610",
  height: 100,                
  justifyContent: "center",
  alignItems: "center",       
  paddingBottom: 10,
  paddingTop: 45, 
  flexDirection: "row",
        
},

headerRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
},

headerText: {
  fontSize: 22,
  fontWeight: "bold",
  color: "#000",
},

  tabs: {
    flexDirection: "row",
    padding: 15,
    justifyContent : "space-around"
  },

  activeTab: {
    marginRight: 15,
    fontWeight: "bold",
    borderBottomWidth: 2,
    borderBottomColor: "#E6330A",
  },

  tab: {
    marginRight: 10,
  },

  card: {
    backgroundColor: "#D9D9D9",
    margin: 10,
    padding: 15,
    borderRadius: 12,
  },

  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 5,
  },

  badge: {
    backgroundColor: "#DC0F0F",
    paddingHorizontal: 10,
    borderRadius: 10,
    color: "#000",
  },

  name: {
    fontWeight: "bold",
    fontSize: 16,
  },

  payment: {
    marginTop: 8,
    fontWeight: "500",
  },

  buttonRow: {
    flexDirection: "row",
    marginTop: 10,
  },

  acceptBtn: {
    backgroundColor: "green",
    padding: 10,
    borderRadius: 10,
    marginRight: 10,
    flex: 1,
    alignItems: "center",
  },

  rejectBtn: {
    backgroundColor: "#DC0F0F",
    padding: 10,
    borderRadius: 10,
    flex: 1,
    alignItems: "center",
  },

  btnText: {
    color: "#fff",
    fontWeight: "bold",
  },

  prepareBtn: {
  backgroundColor: "#FFA726",
  marginTop: 12,
  paddingVertical: 12,
  borderRadius: 10,
  alignItems: "center",
},

prepareText: {
  color: "#000",
  fontWeight: "600",
  fontSize: 15,
},

readyBtn: {
  backgroundColor: "#E6330A",
  marginTop: 12,
  paddingVertical: 12,
  borderRadius: 10,
  alignItems: "center",
},

readyText: {
  color: "#000",
  fontWeight: "600",
  fontSize: 15,
},

badgeOrange: {
  backgroundColor: "#FFA726",
  paddingHorizontal: 12,
  paddingVertical: 4,
  borderRadius: 20,
},

badgeText: {
  fontWeight: "600",
},

readyBadge: {
  backgroundColor: "green",
  color: "white",
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 10,
},

completeBtn: {
  backgroundColor: "green",
  padding: 10,
  borderRadius: 8,
  alignItems: "center",
  marginTop: 10,
},

completedBox: {
  backgroundColor: "#D3D3D3",
  padding: 10,
  borderRadius: 10,
  alignItems: "center",
  marginTop: 10,
},

completedText: {
  color: "black",
  fontWeight: "500",
},

backBtn: {
  position: "absolute",
  left: 15,
  top: 10,
  padding: 5,
  marginRight: 10,
  marginTop: 5,
},

backText: {
  fontSize: 22,
  fontWeight: "bold",
},

});