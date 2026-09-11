export function Ball() {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="ballLight" cx=".32" cy=".22" r=".8">
          <stop stopColor="#fff" stopOpacity=".65" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#152523" stopOpacity=".25" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="#fcfcf7" />
      <path d="M4 50a46 46 0 0 1 92 0Z" fill="#fa6558" />
      <path d="M5 48h90v9H5z" fill="#294b43" />
      <circle cx="50" cy="52" r="15" fill="#294b43" />
      <circle cx="50" cy="52" r="10" fill="#fff" />
      <circle cx="50" cy="52" r="6" fill="#edf4ee" />
      <circle cx="50" cy="50" r="46" fill="url(#ballLight)" />
    </svg>
  );
}
