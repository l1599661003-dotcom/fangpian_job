export type OfferTemplateType = '实习' | '社招'
export type OfferTemplateFieldType = 'text' | 'number' | 'date' | 'select' | 'textarea'
export interface OfferTemplateFieldInput { key:string; label:string; inputType:OfferTemplateFieldType; required?:boolean; enabled?:boolean; locked?:boolean; placeholder?:string; options?:string[] }
export interface OfferSalaryStructure { 日薪?:number; 底薪?:number; 绩效?:number; 其他?:number; 提成?:number }
export interface OfferInput { candidateId:string; interviewId?:string; applicationId?:string; positionId?:string; demandId?:string; role:string; department?:string; location?:string; baseSalary:number; performanceSalary?:number; commission?:number; bonusMonths?:number; salaryStructure?:OfferSalaryStructure; startDate:string; probationMonths?:string; operator?:string; operatorUserId?:string; templateId?:string; candidateHonorific?:string; reportingTo?:string; validFrom?:string; validTo?:string }
export interface OfferTemplateCreateInput { name:string; type:OfferTemplateType; description?:string; content?:string; fields?:OfferTemplateFieldInput[]; status?:'启用'|'停用'; operator?:string }
export interface OfferTemplateUpdateInput { name?:string; description?:string; content?:string; variables?:string[]; fields?:OfferTemplateFieldInput[]; status?:'启用'|'停用'; operator?:string }
export interface OfferApprovalInput { action:'approve'|'reject'; node:'department'|'hr'|'executive'; opinion:string; operator?:string; operatorUserId?:string; role?:string }
export interface OfferNegotiationInput { candidateRequest:string; companyResponse:string; adjustments:Record<string,unknown>; result:string; operator?:string }
