import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        /* 锚定：line 色确保双主题下与底面（bg/soft）都有可见对比；
           accent 在浅色下与页面底色过近，骨架近似不可见。 */
        "animate-pulse rounded-[10px] bg-line",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
