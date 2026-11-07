import Image from "next/image";

export function BrandIcon({ size = 32 }: { size?: number }) {
  return <Image src="/brand/icon/symbol-transparent.svg" width={size} height={size} alt="" aria-hidden="true" unoptimized style={{ objectFit: "contain" }} />;
}
