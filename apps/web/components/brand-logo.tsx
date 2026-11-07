import Image from "next/image";

export function BrandLogo() {
  return (
    <span className="brand-logo" role="img" aria-label="InfraDeck">
      <Image className="brand-logo-dark" src="/brand/logo/horizontal-dark.svg" width={1040} height={300} alt="" unoptimized />
      <Image className="brand-logo-light" src="/brand/logo/horizontal-light.svg" width={1040} height={300} alt="" unoptimized />
    </span>
  );
}
