import Link from "next/link";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export function AppBreadcrumb({ items, current }: {
  items: { label: string; href: string }[];
  current: string;
}) {
  return (
    <Breadcrumb className="mb-2">
      <BreadcrumbList>
        {items.map((item) => (
          <Fragment key={item.href}>
            <BreadcrumbItem><BreadcrumbLink render={<Link href={item.href} />}>{item.label}</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
          </Fragment>
        ))}
        <BreadcrumbItem><BreadcrumbPage className="max-w-44 truncate font-medium sm:max-w-72">{current}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
