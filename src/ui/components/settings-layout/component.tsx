import s from "./styles.module.scss";
import config from "../../../../package.json";
import { FC, ReactNode } from "react";
import { browserTabsCreate } from "@/shared/utils/browser";
import { WOJAKCOIN_URL } from "@/shared/constant";

interface SettingsLayoutProps {
  children: ReactNode;
}

const SettingsLayout: FC<SettingsLayoutProps> = ({ children }) => {
  return (
    <div className={s.wrapper}>
      <div className={s.settings}>{children}</div>
      <div className={s.version}>
        Version <span>{config.version}</span> | By{" "}
        <a
          href="#"
          onClick={async () => {
            await browserTabsCreate({
              url: WOJAKCOIN_URL,
              active: true,
            });
          }}
        >
          WojakCoin team
        </a>
      </div>
    </div>
  );
};

export default SettingsLayout;
