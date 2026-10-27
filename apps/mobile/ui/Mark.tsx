import Svg, { Path, Polygon } from "react-native-svg";

type Props = { size?: number };

export function Mark({ size = 22 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path
        d="M 8 8 L 56 8 L 56 38 L 38 56 L 8 56 Z M 20 18 L 30 18 A 14 14 0 0 1 44 32 A 14 14 0 0 1 30 46 L 20 46 Z"
        fill="#e4e9e5"
        fillRule="evenodd"
      />
      <Polygon points="56,44 56,56 44,56" fill="#d4f45e" />
    </Svg>
  );
}
