export function SkeletonLine({ width = "100%", height = "h-4" }: { width?: string; height?: string }) {
  return (
    <div
      className={`${height} rounded bg-gray-700 animate-pulse`}
      style={{ width }}
    />
  );
}

export function SkeletonCircle({ size = "h-3 w-3" }: { size?: string }) {
  return <div className={`${size} rounded-full bg-gray-700 animate-pulse`} />;
}

export function AgentStatusSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2].map((i) => (
        <div key={i} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <SkeletonCircle />
            <SkeletonLine width="180px" />
          </div>
          <SkeletonLine width="80px" />
        </div>
      ))}
    </div>
  );
}

export function CostTrackerSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <SkeletonLine width="60px" height="h-3" />
        <div className="mt-2">
          <SkeletonLine width="100px" height="h-7" />
        </div>
      </div>
      <div>
        <SkeletonLine width="50px" height="h-3" />
        <div className="mt-2">
          <SkeletonLine width="60px" height="h-7" />
        </div>
      </div>
    </div>
  );
}

export function ActivityFeedSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="border-b border-gray-700 pb-2">
          <div className="flex items-center gap-2 mb-1">
            <SkeletonLine width="70px" height="h-3" />
            <SkeletonLine width="100px" height="h-3" />
          </div>
          <div className="ml-16">
            <SkeletonLine width="200px" height="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TaskLogSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center justify-between border-b border-gray-700 pb-2">
          <div className="flex items-center gap-2">
            <SkeletonCircle size="h-2 w-2" />
            <SkeletonLine width="120px" />
          </div>
          <SkeletonLine width="50px" height="h-3" />
        </div>
      ))}
    </div>
  );
}
