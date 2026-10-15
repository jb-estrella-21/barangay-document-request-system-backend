import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

type RequestWithLogRoute = Request & { logRouteTemplate?: string };

@Injectable()
export class RequestRouteGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const controllerPath = this.reflector.get<string | string[]>(PATH_METADATA, context.getClass());
    const handlerPath = this.reflector.get<string | string[]>(PATH_METADATA, context.getHandler());
    context.switchToHttp().getRequest<RequestWithLogRoute>().logRouteTemplate = routeTemplateFor(controllerPath, handlerPath);
    return true;
  }
}

export function routeTemplateFor(controllerPath?: string | string[], handlerPath?: string | string[]): string {
  const segments = [firstPath(controllerPath), firstPath(handlerPath)]
    .filter((segment): segment is string => Boolean(segment))
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean);
  const route = `/${segments.join('/')}`;
  return /^\/[A-Za-z0-9_./:-]*$/.test(route) ? route : '/<unmatched>';
}

function firstPath(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
