import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTenantDto) {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(
        `A school with slug "${dto.slug}" already exists`,
      );
    }

    return this.prisma.tenant.create({ data: dto });
  }

  async findAll() {
    return this.prisma.tenant.findMany({
      where: { isActive: true, archivedAt: null },
      orderBy: { nameEn: 'asc' },
      select: {
        id: true,
        nameAr: true,
        nameEn: true,
        slug: true,
        logoUrl: true,
        governorate: true,
        isActive: true,
        _count: { select: { users: true } },
      },
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        departments: true,
        subscriptionTier: true,
        _count: { select: { users: true, classrooms: true, busRoutes: true } },
      },
    });
    if (!tenant) throw new NotFoundException(`Tenant ${id} not found`);
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.findOne(id); // Throws 404 if not found
    return this.prisma.tenant.update({ where: { id }, data: dto });
  }

  async archive(id: string) {
    await this.findOne(id);
    return this.prisma.tenant.update({
      where: { id },
      data: { archivedAt: new Date(), isActive: false },
    });
  }
}
