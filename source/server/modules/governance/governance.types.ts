export interface TransitionInput{stage:string;reason:string;operator?:string;operatorUserId?:string;force?:boolean;forceReason?:string}
export interface RatingInput{rating:'S'|'A'|'B'|'C'|'D';reason:string;evidence?:string[];sourceType?:string;sourceId?:string;operator?:string;operatorUserId?:string}
