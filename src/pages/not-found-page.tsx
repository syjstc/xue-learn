import { Link } from "react-router-dom";
import { Button } from "@xue-learn/core/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useT } from "@xue-learn/core/i18n";

export function NotFoundPage() {
  const t = useT();

  return (
    <div className="mx-auto max-w-lg py-16">
      <Card className="text-center">
        <CardHeader>
          <div className="mx-auto mb-2 text-5xl" aria-hidden>
            🔍
          </div>
          <CardTitle>{t("notFound.title")}</CardTitle>
          <CardDescription>{t("notFound.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/">
            <Button>{t("notFound.home")}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
