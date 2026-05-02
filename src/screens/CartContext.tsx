import React, { createContext, useContext, useState } from "react";

interface CartItem {
  id: string;
  name: string;
  price: number;
  image: any;
  quantity: number;
}

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: Omit<CartItem, "id" | "quantity">) => void;
}

// ✅ proper default values
const CartContext = createContext<CartContextType>({
  cart: [],
  addToCart: () => {},
});

export function CartProvider({ children }: any) {
  const [cart, setCart] = useState<CartItem[]>([]);

  const addToCart = (item: Omit<CartItem, "id" | "quantity">) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.name === item.name);
      if (existing) {
        return prev.map((i) =>
          i.name === item.name ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...item, id: item.name, quantity: 1 }];
    });
  };

  return (
    <CartContext.Provider value={{ cart, addToCart }}>
      {children}
    </CartContext.Provider>
  );
}

export const useCart = () => useContext(CartContext);