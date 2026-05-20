// import {
//   createContext,
//   useContext,
//   useEffect,
//   useState,
//   type ReactNode,
// } from "react";
// import { onAuthStateChanged } from "firebase/auth";
// import type { User } from "firebase/auth";
// import { auth } from "../../firebase.ts";
//
// const AuthContext = createContext<{ user: User | null; loading: boolean }>({
//   user: null,
//   loading: true,
// });
//
// export const AuthProvider = ({ children }: { children: ReactNode }) => {
//   const [user, setUser] = useState<User | null>(null);
//   const [loading, setLoading] = useState(true);
//
//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
//       setUser(currentUser);
//       setLoading(false);
//     });
//     return unsubscribe;
//   }, []);
//
//   return (
//     <AuthContext.Provider value={{ user, loading }}>
//       {children}
//     </AuthContext.Provider>
//   );
// };
//
// export const useAuth = () => useContext(AuthContext);
//


import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type { User } from "firebase/auth";

// 👇 mock user (minimal fields you actually use)
const mockUser = {
  uid: "12345",
  email: "nejofjn@example.com",
  displayName: "ncejkfnrejklfbjk",
} as User;

const AuthContext = createContext<{
  user: User;
  loading: boolean;
}>({
  user: mockUser,
  loading: false,
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  return (
    <AuthContext.Provider value={{ user: mockUser, loading: false }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
