import { CATALOG_TEMPLATE } from "@jwitmann/vcc-brain-core/templates/catalog";
import { PROJECT_INDEX_TEMPLATE } from "@jwitmann/vcc-brain-core/templates/project-index";
import { PROJECT_SUBINDEX_TEMPLATE } from "@jwitmann/vcc-brain-core/templates/project-subindex";

import { PROJECT_CONFIG_TEMPLATE } from "./templates/project/config.ts";
import { PROJECT_INDEX_SETUP_TEMPLATE } from "./templates/project/index-setup.ts";
import { PROJECT_VCC_BRAIN_TEMPLATE } from "./templates/project/vcc-brain.ts";
import { PROJECT_SETUP_TEMPLATE } from "./templates/project/setup.ts";
import { PROJECT_SHARED_README_TEMPLATE } from "./templates/project/shared-readme.ts";
import { USER_VCC_BRAIN_TEMPLATE } from "./templates/user/vcc-brain.ts";
import { USER_SETUP_TEMPLATE } from "./templates/user/setup.ts";

export enum TemplatePath {
  UserVccBrain = "user/vcc-brain.md",
  UserCatalog = "user/catalog.md",
  UserSetup = "user/setup.md",
  ProjectVccBrain = "project/vcc-brain.md",
  ProjectConfig = "project/config.json",
  ProjectIndex = "project/index.md",
  ProjectSubindex = "project/subindex.md",
  ProjectCatalog = "project/catalog.md",
  ProjectSetup = "project/setup.md",
  ProjectIndexSetup = "project/index-setup.md",
  ProjectSharedReadme = "project/shared-readme.md",
}

const TEMPLATES = {
  [TemplatePath.UserVccBrain]: USER_VCC_BRAIN_TEMPLATE,
  [TemplatePath.UserCatalog]: CATALOG_TEMPLATE,
  [TemplatePath.UserSetup]: USER_SETUP_TEMPLATE,
  [TemplatePath.ProjectVccBrain]: PROJECT_VCC_BRAIN_TEMPLATE,
  [TemplatePath.ProjectConfig]: PROJECT_CONFIG_TEMPLATE,
  [TemplatePath.ProjectIndex]: PROJECT_INDEX_TEMPLATE,
  [TemplatePath.ProjectSubindex]: PROJECT_SUBINDEX_TEMPLATE,
  [TemplatePath.ProjectCatalog]: CATALOG_TEMPLATE,
  [TemplatePath.ProjectSetup]: PROJECT_SETUP_TEMPLATE,
  [TemplatePath.ProjectIndexSetup]: PROJECT_INDEX_SETUP_TEMPLATE,
  [TemplatePath.ProjectSharedReadme]: PROJECT_SHARED_README_TEMPLATE,
} satisfies Record<TemplatePath, string>;

export function readTemplate(path: TemplatePath): string {
  return TEMPLATES[path];
}
