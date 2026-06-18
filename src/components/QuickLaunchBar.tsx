const APPS = [
  { label: "Settings", package: "com.android.settings" },
  { label: "Chrome", package: "com.android.chrome" },
  { label: "Camera", package: "com.android.camera" },
  { label: "Play Store", package: "com.android.vending" },
  { label: "Phone", package: "com.google.android.dialer" },
  { label: "Messages", package: "com.google.android.apps.messaging" },
];

interface Props {
  canSendKeys: boolean;
  onOpenApp: (pkg: string) => void;
}

export function QuickLaunchBar({ canSendKeys, onOpenApp }: Props) {
  return (
    <div className="quick-launch glass-panel">
      <p className="panel-title">Quick open</p>
      <div className="quick-launch-scroll">
        {APPS.map((app) => (
          <button
            key={app.package}
            type="button"
            className="quick-launch-btn"
            disabled={!canSendKeys}
            onClick={() => onOpenApp(app.package)}
          >
            {app.label}
          </button>
        ))}
      </div>
    </div>
  );
}
