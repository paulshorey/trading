"use client";

import { ReactNode } from "react";

interface ButtonProps {
  children: ReactNode;
  className?: string;
  appName: string;
}

// export const Button = ({ children, className, appName }: ButtonProps) => {
//   return (
//     <button className={className} onClick={() => alert(`Hello from your ${appName} app!`)}>
//       {children}
//     </button>
//   );
// };

export const Button = ({ children, ...props }: ButtonProps) => {
  return (
    <button value={"sfsfds"} data-component="button" {...props}>
      {children}
    </button>
  );
};
