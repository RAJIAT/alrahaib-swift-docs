import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { Component, type ReactNode } from "react";
import { LanguageProvider, useLang } from "@/i18n/LanguageProvider";
import { Footer } from "@/components/Footer";
import { DemoBanner } from "@/components/DemoBanner";
import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("App error boundary:", error); }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <h1 className="text-2xl font-bold text-foreground">حدث خطأ غير متوقع</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            صار في مشكلة. اضغط الزر لإعادة تحميل الصفحة.
          </p>
          <button
            onClick={() => { this.reset(); if (typeof window !== "undefined") window.location.reload(); }}
            className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-soft"
          >
            إعادة التحميل
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground text-center">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "رفع المستندات" },
      { name: "description", content: "بوابة آمنة لرفع مستندات التأمين (الرخصة، الاستمارة، الهوية) ." },
      { name: "theme-color", content: "#1f2233" },
      { property: "og:site_name", content: "Middle East Insurance" },
      { property: "og:title", content: "رفع المستندات" },
      { name: "twitter:title", content: "رفع المستندات" },
      { property: "og:description", content: "بوابة آمنة لرفع مستندات التأمين (الرخصة، الاستمارة، الهوية) ." },
      { name: "twitter:description", content: "بوابة آمنة لرفع مستندات التأمين (الرخصة، الاستمارة، الهوية) ." },
      { property: "og:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/ZB4VEHbTzTSvXvVaalw05WZckEj2/social-images/social-1777831614105-logo.webp" },
      { property: "og:image:alt", content: "Middle East Insurance" },
      { name: "twitter:image", content: "https://storage.googleapis.com/gpt-engineer-file-uploads/ZB4VEHbTzTSvXvVaalw05WZckEj2/social-images/social-1777831614105-logo.webp" },
      { name: "twitter:card", content: "summary" },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "ar_AE" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/webp", href: "/logo.webp" },
      { rel: "apple-touch-icon", href: "/logo.webp" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  return (
    <AppErrorBoundary>
      <LanguageProvider>
        <AppChrome />
      </LanguageProvider>
    </AppErrorBoundary>
  );
}

function AppChrome() {
  const { dir } = useLang();
  return (
    <div className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="flex-1">
        <Outlet />
      </div>
      <Footer />
      <Toaster position="top-center" richColors closeButton dir={dir} />
    </div>
  );
}
