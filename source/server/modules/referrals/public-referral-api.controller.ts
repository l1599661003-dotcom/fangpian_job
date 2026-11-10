import { BadRequestException, Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common'
import { ReferralCampaignInput } from './referral.types'
import { ReferralsService } from './referrals.service'
import { ResumeApiKeyService } from '../resumes/resume-api-key.service'

const text = (value: unknown) => String(value ?? '').trim()

@Controller('api/public/referral-api')
export class PublicReferralApiController {
  constructor(private readonly referrals: ReferralsService, private readonly apiKeys: ResumeApiKeyService) {}

  private async authorize(key?: string) {
    if (!await this.apiKeys.validate(key)) throw new UnauthorizedException('X-API-Key 缺失、错误或已被轮换')
  }

  @Get('positions')
  async positions(@Headers('x-api-key') key: string | undefined) {
    await this.authorize(key)
    const result = await this.referrals.publishedPositions()
    return {
      keyValidity: '长期有效，直到主动轮换密钥',
      positions: result.positions,
    }
  }

  @Post('campaigns')
  async campaign(@Headers('x-api-key') key: string | undefined, @Body() body: ReferralCampaignInput) {
    await this.authorize(key)
    const referrerName = text(body?.referrerName)
    const referrerMobile = text(body?.referrerMobile).replace(/\s|-/g, '')
    if (!referrerName || !referrerMobile) throw new BadRequestException('生成内推海报必须填写推荐人姓名和手机号')
    const created = await this.referrals.createCampaign({
      ...body,
      name: text(body?.name) || `${referrerName}内推`,
      role: text(body?.role) || '全部岗位',
      referrerName,
      referrerMobile,
      operator: text(body?.operator) || '外部API',
      operatorUserId: text(body?.operatorUserId) || 'external-api',
    })
    return {
      campaignId: created.campaignId,
      publicUrl: created.publicUrl,
      qrCode: created.qrCode,
      token: created.token || '',
      status: created.status,
      reused: Boolean(created.reused),
      referrerName: created.referrerName,
      referrerMobile: created.referrerMobile,
      keyValidity: '长期有效，直到主动轮换密钥',
    }
  }
}
