import { cn } from "@xue-learn/core/source/src/shared/utils.ts";
import { useI18n } from "@xue-learn/core/source/src/shared/i18n/index.tsx";

const sizeClasses = {
  sm: "h-8 w-auto",
  md: "h-10 w-auto",
  lg: "h-14 w-auto",
  xl: "h-20 w-auto",
  hero: "h-24 w-auto",
} as const;

type BrandLogoSize = keyof typeof sizeClasses;

const wordmarkSizeClasses = {
  sm: "h-6 w-auto",
  md: "h-8 w-auto",
  lg: "h-10 w-auto",
} as const;

type BrandWordmarkSize = keyof typeof wordmarkSizeClasses;

const lockupSizeClasses = {
  md: "h-20 w-auto",
  lg: "h-24 w-auto",
} as const;

type BrandLockupSize = keyof typeof lockupSizeClasses;

const navBrandSizeClasses = {
  sm: "h-8 w-auto",
  md: "h-10 w-auto",
} as const;

type NavBrandSize = keyof typeof navBrandSizeClasses;

type BrandLogoProps = {
  size?: BrandLogoSize;
  className?: string;
};

/** Transparent logo mark (book + tree), no icon frame or padding. */
export function BrandLogo({ size = "sm", className }: BrandLogoProps) {
  return (
    <img
      src="/logo-mark.png"
      alt=""
      width={722}
      height={796}
      className={cn(
        sizeClasses[size],
        "shrink-0 transition-transform group-hover:-translate-y-px",
        className,
      )}
      aria-hidden
    />
  );
}

type BrandWordmarkProps = {
  size?: BrandWordmarkSize;
  className?: string;
};

/** Transparent localized wordmark. Uses a light ink variant in dark mode. */
export function BrandWordmark({ size = "sm", className }: BrandWordmarkProps) {
  const { locale, t } = useI18n();
  const imageClassName = cn(wordmarkSizeClasses[size], "w-auto");

  if (locale === "en") {
    return (
      <span
        className={cn("relative inline-flex shrink-0 items-center", className)}
        role="img"
        aria-label={t("app.brand")}
      >
        <img
          src="/xuelearn-wordmark-en-cropped.png"
          alt=""
          width={2172}
          height={724}
          className={cn(imageClassName, "block dark:hidden")}
        />
        <img
          src="/xuelearn-wordmark-en-dark.png"
          alt=""
          width={2143}
          height={734}
          className={cn(imageClassName, "hidden dark:block")}
        />
      </span>
    );
  }

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center", className)}
      aria-hidden
    >
      <img
        src="/haohuixue-wordmark.png"
        alt=""
        width={1541}
        height={531}
        className={cn(imageClassName, "block dark:hidden")}
      />
      <img
        src="/haohuixue-wordmark-dark.png"
        alt=""
        width={1541}
        height={531}
        className={cn(imageClassName, "hidden dark:block")}
      />
    </span>
  );
}

type BrandLockupProps = {
  size?: BrandLockupSize;
  className?: string;
};

/** Transparent wordmark plus tagline. Uses a light ink variant in dark mode. */
export function BrandLockup({ size = "md", className }: BrandLockupProps) {
  const { locale, t } = useI18n();
  const imageClassName = cn(lockupSizeClasses[size], "w-auto");

  if (locale === "en") {
    return (
      <span
        className={cn("relative inline-flex shrink-0 items-center", className)}
        role="img"
        aria-label={t("app.brand")}
      >
        <img
          src="/xuelearn-wordmark-en-cropped.png"
          alt=""
          width={2172}
          height={724}
          className={cn(imageClassName, "block dark:hidden")}
        />
        <img
          src="/xuelearn-wordmark-en-dark.png"
          alt=""
          width={2143}
          height={734}
          className={cn(imageClassName, "hidden dark:block")}
        />
      </span>
    );
  }

  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center", className)}
      aria-hidden
    >
      <img
        src="/haohuixue-transparent.png"
        alt=""
        width={1541}
        height={723}
        className={cn(imageClassName, "block dark:hidden")}
      />
      <img
        src="/haohuixue-transparent-dark.png"
        alt=""
        width={1541}
        height={723}
        className={cn(imageClassName, "hidden dark:block")}
      />
    </span>
  );
}

type NavBrandProps = {
  size?: NavBrandSize;
  className?: string;
  /** Always the light lockup, even when the learner shell is `.dark`. */
  forceLight?: boolean;
};

/** Navigation lockup: the logo mark plus the localized wordmark. */
export function NavBrand({
  size = "sm",
  className,
  forceLight = false,
}: NavBrandProps) {
  const { locale } = useI18n();
  const wordmarkSize = size === "sm" ? "sm" : "md";

  if (locale === "en") {
    return (
      <span
        className={cn(
          navBrandSizeClasses[size],
          "inline-flex shrink-0 items-center gap-2",
          className,
        )}
        aria-hidden
      >
        <BrandLogo size={size} />
        {forceLight ? (
          <img
            src="/xuelearn-wordmark-en-cropped.png"
            alt=""
            width={2172}
            height={724}
            className={cn(wordmarkSizeClasses[wordmarkSize], "w-auto")}
          />
        ) : (
          <BrandWordmark size={wordmarkSize} />
        )}
      </span>
    );
  }

  return (
    <span
      className={cn(
        navBrandSizeClasses[size],
        "inline-block aspect-[1126/376] shrink-0 bg-contain bg-left bg-no-repeat",
        forceLight
          ? "bg-[url('/haohuixue-nav-brand.png')]"
          : "bg-[url('/haohuixue-nav-brand.png')] dark:bg-[url('/haohuixue-nav-brand-dark.png')]",
        className,
      )}
      aria-hidden
    />
  );
}
