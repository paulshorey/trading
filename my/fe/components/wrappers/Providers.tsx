import { MantineProvider } from "@mantine/core";
import { theme } from "../../styles/theme";

import "../../styles/tailwind.css";
import "../../styles/global.scss";
import "@mantine/core/styles.css";
import "../../styles/mantine.scss";

export function Providers({ children, defaultColorScheme }: any) {
  return (
    <MantineProvider forceColorScheme={defaultColorScheme} theme={theme}>
      {children}
    </MantineProvider>
  );
}
