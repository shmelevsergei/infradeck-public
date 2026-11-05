export function BrandIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path
        d="m16 2 13 7.5v15L16 32 3 24.5v-15L16 2Zm0 5L7 12v10l9 5 9-5V12l-9-5Z"
        fill="currentColor"
      />
      <path
        d="m8 12 8 4.5 8-4.5M16 17v10"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
    </svg>
  );
}
