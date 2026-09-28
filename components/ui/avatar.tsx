type AvatarProps = {
  name: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
};

const sizes = {
  sm: "size-10 text-sm",
  md: "size-12 text-base",
  lg: "size-24 text-2xl",
};

export function Avatar({ name, imageUrl, size = "md" }: AvatarProps) {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div
      role="img"
      aria-label={`${name}'s profile picture`}
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--avatar-bg)] font-semibold text-[var(--ink)] ${sizes[size]}`}
    >
      {imageUrl ? (
        <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${imageUrl}")` }} aria-hidden="true" />
      ) : (
        initials || "?"
      )}
    </div>
  );
}