import { FC } from "react";
import { useNavigate } from "react-router-dom";
import { shortAddress } from "@/shared/utils/transactions";
import { useAppState } from "@/ui/states/appState";
import { ss } from "@/ui/utils";
import { getContentUrl } from "@/shared/constant";
import Iframe from "@/ui/components/iframe";

interface Props {
  inscriptionId: string;
}

const InscriptionCard: FC<Props> = ({ inscriptionId }) => {
  const navigate = useNavigate();
  const { network } = useAppState(ss(["network"]));

  return (
    <div className="flex justify-center w-full">
      <div
        className="cursor-pointer flex flex-col justify-center align-center relative"
        onClick={() => {
          navigate("/pages/inscription-details", {
            state: { inscription_id: inscriptionId },
          });
        }}
      >
        <div className="rounded-xl w-full bg-slate-950 bg-opacity-50 relative">
          {/* upstream ord serves an HTML preview (works for text + images), so
              render it in an iframe; the overlay keeps the card clickable. */}
          <Iframe
            preview={`${getContentUrl(network)}/preview/${inscriptionId}`}
            size="default"
          />
          <div className="absolute inset-0" />
        </div>
        <div className="absolute bottom-0 px-1 bg-black/50 backdrop-blur-sm left-0 text-xs text-white">
          {shortAddress(inscriptionId, 6)}
        </div>
      </div>
    </div>
  );
};

export default InscriptionCard;
