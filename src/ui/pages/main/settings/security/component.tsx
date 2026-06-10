import { DocumentTextIcon, KeyIcon } from "@heroicons/react/24/outline";
import Tile from "@/ui/components/tile";
import { TileProps } from "@/ui/components/tile/component";

import { t } from "i18next";
import SettingsLayout from "@/ui/components/settings-layout";
import { useGetCurrentWallet, useWalletState } from "@/ui/states/walletState";
import { ss } from "@/ui/utils";

const ICON_SIZE = 8;
const ICON_CN = `w-${ICON_SIZE} h-${ICON_SIZE}`;

const Security = () => {
  const currentWallet = useGetCurrentWallet();
  const { selectedAccount } = useWalletState(ss(["selectedAccount"]));

  const items: TileProps[] = [
    {
      icon: <KeyIcon className={ICON_CN} />,
      label: t("components.layout.change_password"),
      link: "/pages/change-password",
    },
    {
      icon: <DocumentTextIcon className={ICON_CN} />,
      label: t("switch_wallet.show_mnemonic_private_key"),
      link: `/pages/show-mnemonic/${currentWallet?.id ?? 0}`,
    },
    {
      icon: <KeyIcon className={ICON_CN} />,
      label: t("switch_account.export_private_key"),
      link: `/pages/show-pk/${selectedAccount ?? 0}`,
    },
  ];

  return (
    <SettingsLayout>
      {items.map((i) => (
        <Tile key={i.label} {...i} />
      ))}
    </SettingsLayout>
  );
};

export default Security;
