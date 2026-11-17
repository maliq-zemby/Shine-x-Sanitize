import heroInteriorImg from '../assets/images/hero_libreville_interior_1794779520180.jpg';
import serviceSofaImg from '../assets/images/sofa_cleaning_local_1794857230394.jpg';
import serviceMattressImg from '../assets/images/mattress_sanitizing_local_1794857230761.jpg';
import serviceCarDetailingImg from '../assets/images/car_detailing_local_1794857231249.jpg';
import serviceCarpetFloorImg from '../assets/images/floor_carpet_local_1794857231945.jpg';
import serviceArmchairImg from '../assets/images/armchair_cleaning_local_1794857233048.jpg';
import servicePostRenovationImg from '../assets/images/post_construction_local_1794857232790.jpg';
import serviceOfficeImg from '../assets/images/office_cleaning_local_1794857233961.jpg';
import agentScooterImg from '../assets/images/agent_scooter_local_1794857234278.jpg';

export type AssetKey =
  | 'hero'
  | 'sofa'
  | 'mattress'
  | 'carDetailing'
  | 'carpetFloor'
  | 'armchair'
  | 'postRenovation'
  | 'car'
  | 'office'
  | 'scooter';

export const ASSET_MAP: Record<AssetKey, string> = {
  hero: heroInteriorImg,
  sofa: serviceSofaImg,
  mattress: serviceMattressImg,
  carDetailing: serviceCarDetailingImg,
  carpetFloor: serviceCarpetFloorImg,
  armchair: serviceArmchairImg,
  postRenovation: servicePostRenovationImg,
  car: serviceCarDetailingImg,
  office: serviceOfficeImg,
  scooter: agentScooterImg,
};
