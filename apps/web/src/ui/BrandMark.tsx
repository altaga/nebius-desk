type Props = { size?: number };

export function BrandMark({ size = 22 }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
      <path
        fill="#e4e9e5"
        fillRule="evenodd"
        d="M8 8H56V34L34 56H8V8zM16 16H28A16 16 0 0 1 44 32A16 16 0 0 1 28 48H16V16z"
      />
      <path fill="#d4f45e" d="M56 40v16H40z" />
    </svg>
  );
}
