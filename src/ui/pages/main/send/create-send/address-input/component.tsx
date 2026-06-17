import { shortAddress } from "@/shared/utils/transactions";
import { Combobox, Transition } from "@headlessui/react";
import { BookOpenIcon, QrCodeIcon } from "@heroicons/react/24/outline";
import s from "./styles.module.scss";
import { FC, Fragment, useRef, useState } from "react";
import { useAppState } from "@/ui/states/appState";
import { t } from "i18next";
import { ss } from "@/ui/utils";
import jsQR from "jsqr";
import type { BridgeQrData } from "@/shared/utils/parse-bridge-qr";
import { parseBridgeQr } from "@/shared/utils/parse-bridge-qr";

interface Props {
  address: string;
  onChange: (value: string) => void;
  onOpenModal: () => void;
  placeholder?: string;
  onQrScan?: (data: BridgeQrData) => void;
}

async function decodeQrFromFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const result = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
      resolve(result?.data ?? null);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

const AddressInput: FC<Props> = ({ address, onChange, onOpenModal, placeholder, onQrScan }) => {
  const [filtered, setFiltered] = useState<string[]>([]);
  const [qrError, setQrError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { addressBook } = useAppState(ss(["addressBook"]));

  const getFiltered = (query: string) => {
    return addressBook.filter((i) => i.startsWith(query));
  };

  const handleQrFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setQrError("");
    const text = await decodeQrFromFile(file);
    if (!text) {
      setQrError("No QR code found in image");
      return;
    }
    const data = parseBridgeQr(text);
    if (!data?.address) {
      setQrError("QR does not contain a valid address");
      return;
    }
    onChange(data.address);
    onQrScan?.(data);
  };

  return (
    <div className="flex gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleQrFileChange}
      />
      <Combobox value={address} onChange={onChange}>
        <div className="relative w-full">
          <Combobox.Input
            displayValue={(address: string) => address}
            autoComplete="off"
            className="input w-full"
            value={address}
            placeholder={placeholder ?? t("send.create_send.address_input.address_placeholder")}
            onChange={(v) => {
              onChange(v.target.value.trim());
              setFiltered(getFiltered(v.target.value.trim()));
            }}
          />

          {filtered.length > 0 ? (
            <Transition
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Combobox.Options className={s.addressbookoptions}>
                {filtered.map((address) => (
                  <Combobox.Option
                    className={s.addressbookoption}
                    key={address}
                    value={address}
                  >
                    {shortAddress(address, 14)}
                  </Combobox.Option>
                ))}
              </Combobox.Options>
            </Transition>
          ) : (
            ""
          )}
        </div>
      </Combobox>

      {/* QR scan button */}
      <div
        className="bg-input-bg px-2 rounded-xl cursor-pointer flex items-center justify-center"
        title="Scan QR code"
        onClick={() => { setQrError(""); fileInputRef.current?.click(); }}
      >
        <QrCodeIcon className="w-5 h-5" />
      </div>

      {/* Address book button */}
      <div
        className="bg-input-bg px-2 rounded-xl cursor-pointer flex items-center justify-center"
        title={t("send.create_send.address_input.address_book")}
        onClick={(e) => {
          e.preventDefault();
          onOpenModal();
        }}
      >
        <BookOpenIcon className="w-5 h-5" />
      </div>

      {qrError && (
        <p className="absolute mt-10 text-xs text-red-500">{qrError}</p>
      )}
    </div>
  );
};

export default AddressInput;
