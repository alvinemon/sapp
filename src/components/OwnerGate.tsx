interface Props {
  children: React.ReactNode;
}

/** Owner portal — open access (no key gate). Set OPEN_ACCESS=false on server to lock down. */
export function OwnerGate({ children }: Props) {
  return <>{children}</>;
}
