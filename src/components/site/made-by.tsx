const AUTHORS = [
  { name: "nuu-maan", href: "https://github.com/Nuu-maan" },
  { name: "Ronak", href: "https://github.com/thackerronak" },
];

const link = "underline decoration-dotted underline-offset-4 hover:text-foreground";

export function MadeBy() {
  return (
    <p className="fixed bottom-4 left-4 font-mono text-xs text-muted-foreground">
      made by{" "}
      {AUTHORS.map(({ name, href }, i) => (
        <span key={name}>
          {i > 0 && " & "}
          <a href={href} className={link}>
            {name}
          </a>
        </span>
      ))}
    </p>
  );
}
