import { useControllersState } from "@/ui/states/controllerState";
import { useEffect, useState } from "react";

import { DocumentTextIcon } from "@heroicons/react/24/outline";
import Layout from "../layout";
import { t } from "i18next";
import { ss } from "@/ui/utils";
import { estimateChainTxCount } from "@/background/controllers/inscriber";

interface InscribePayload {
  contentType: string;
  dataHex: string;
  receiver?: string;
  feeRate: number;
}

const Inscribe = () => {
  const [items, setItems] = useState<InscribePayload[]>([]);

  const { notificationController } = useControllersState(
    ss(["notificationController"])
  );

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      const approval = await notificationController.getApproval();
      if (!approval || !approval.params) {
        await notificationController.rejectApproval("Invalid params");
        return;
      }
      const raw = approval.params.data[0];
      setItems(
        Array.isArray(raw) ? (raw as InscribePayload[]) : [raw as InscribePayload]
      );
    })();
  }, [notificationController]);

  const isBatch = items.length > 1;
  const mintsPerWave = 10;
  const waveCount = Math.ceil(items.length / mintsPerWave);
  const first = items[0];
  const totalBytes = items.reduce((n, p) => n + p.dataHex.length / 2, 0);
  const totalTxs = items.reduce(
    (n, p) => n + estimateChainTxCount(p.dataHex.length / 2),
    0
  );

  const previews = items
    .map((p) => {
      try {
        return Buffer.from(p.dataHex, "hex").toString("utf8");
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  return (
    <Layout
      documentTitle={isBatch ? "Inscribe batch" : "Inscribe"}
      resolveBtnClassName="bg-text text-bg hover:bg-orange-500 hover:text-bg"
      resolveBtnText={isBatch ? `Inscribe ${items.length}` : "Inscribe"}
    >
      <>
        <DocumentTextIcon className="w-10 h-10 text-orange-500" />
        <h4 className="text-xl font-medium">
          {isBatch ? `Inscribe batch (${items.length})` : "Inscribe"}
        </h4>
        <div className="text-sm text-gray-400">
          {t("provider.you_are_signing")}
        </div>

        <div className="w-full flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-2 px-1">
            <span className="text-gray-400">Content type</span>
            <span className="text-light-orange break-all text-right">
              {first?.contentType}
            </span>
          </div>
          <div className="flex justify-between gap-2 px-1">
            <span className="text-gray-400">
              {isBatch ? "Total size" : "Size"}
            </span>
            <span className="text-light-orange">{totalBytes} bytes</span>
          </div>
          <div className="flex justify-between gap-2 px-1">
            <span className="text-gray-400">Fee rate</span>
            <span className="text-light-orange">{first?.feeRate} sat/vB</span>
          </div>
          <div className="flex justify-between gap-2 px-1">
            <span className="text-gray-400">
              {isBatch ? "Inscriptions" : "Transactions"}
            </span>
            <span className="text-light-orange">
              {isBatch ? items.length : estimateChainTxCount(totalBytes)}
            </span>
          </div>
          {isBatch && (
            <div className="flex justify-between gap-2 px-1">
              <span className="text-gray-400">Transactions</span>
              <span className="text-light-orange">{totalTxs}</span>
            </div>
          )}
          <div className="flex flex-col gap-1 px-1">
            <span className="text-gray-400">Receiver</span>
            <span className="text-light-orange break-all">
              {first?.receiver ?? "Your address"}
            </span>
          </div>
        </div>

        {previews.length > 0 && (
          <div className="p-2 bg-input-bg rounded-xl max-h-full w-full">
            <div className="break-words whitespace-pre-wrap max-h-40 overflow-y-auto px-1 text-xs flex flex-col gap-2">
              {previews.slice(0, 5).map((text, i) => (
                <div key={i}>
                  {isBatch && (
                    <span className="text-gray-500">#{i + 1}: </span>
                  )}
                  {text}
                </div>
              ))}
              {previews.length > 5 && (
                <span className="text-gray-500">
                  …and {previews.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}

        <div className="text-xs text-gray-500 text-center px-2">
          {isBatch
            ? items.length > mintsPerWave
              ? `Approving mints ${items.length} inscriptions in ${waveCount} waves (${mintsPerWave} per wave, waits for a block between waves). Keep the wallet open until finished.`
              : `Approving signs and broadcasts all ${items.length} inscriptions (${totalTxs} transactions) in one step.`
            : `Approving signs and broadcasts all ${estimateChainTxCount(totalBytes)} transactions in one step.`}
        </div>
      </>
    </Layout>
  );
};

export default Inscribe;
