import React, { useState, useRef, useEffect } from 'react';
import { Warehouse, Building2, Layers, ChevronDown, Check } from 'lucide-react';
import { useStore } from '../context/StoreContext';
import { useAuth } from '../context/AuthContext';

export interface LocationSwitcherProps {
  /** Whether to include "Complete Stock (Hub + All Branches)" option alongside Hub Warehouse and individual Branches */
  includeAllLocations?: boolean;
  /** Custom label for the all_locations option (default: "Complete Stock") */
  allLocationsLabel?: string;
  /** Custom subtitle for the all_locations option */
  allLocationsSubtitle?: string;
  /** Custom label for the hub_warehouse option (default: "Hub Warehouse") */
  hubLabel?: string;
  /** Custom subtitle for the hub_warehouse option */
  hubSubtitle?: string;
  /** Optional callback when selection changes */
  onChange?: (locationId: string) => void;
  /** Additional wrapper className */
  className?: string;
}

const LocationSwitcher: React.FC<LocationSwitcherProps> = ({
  includeAllLocations = false,
  allLocationsLabel = 'Complete Stock',
  allLocationsSubtitle,
  hubLabel = 'Hub Warehouse',
  hubSubtitle = 'Main office storage • Transfers to branches',
  onChange,
  className = '',
}) => {
  const { currentUser } = useAuth();
  const { stores, currentStore, selectedLocation, setCurrentStore, isHubUser } = useStore();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine effective active value for this page
  const effectiveValue =
    !includeAllLocations && selectedLocation === 'all_locations'
      ? 'hub_warehouse'
      : selectedLocation || 'hub_warehouse';

  const activeBranch = stores.find((s) => s.id === effectiveValue) || currentStore;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelect = (val: string) => {
    setCurrentStore(val);
    if (onChange) {
      onChange(val);
    }
    setOpen(false);
  };

  // If user is a branch-locked employee (not hub user and tied to a single store), render a clean static badge
  if (!isHubUser && currentUser?.storeId) {
    return (
      <div
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 ${className}`}
      >
        <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        <span className="truncate max-w-[160px]">{currentStore?.name || 'Assigned Branch'}</span>
      </div>
    );
  }

  // Trigger display metadata
  const isAll = effectiveValue === 'all_locations';
  const isHub = effectiveValue === 'hub_warehouse';

  const triggerTitle = isAll
    ? allLocationsLabel
    : isHub
    ? hubLabel
    : activeBranch?.name || 'Select Location';

  const triggerTag = isAll
    ? 'Hub + Branches'
    : isHub
    ? 'Main Office'
    : 'Branch';

  const triggerTagClass = isAll
    ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
    : isHub
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  const resolvedAllSubtitle =
    allLocationsSubtitle ||
    `Hub Warehouse + ${stores.length} branch${stores.length === 1 ? '' : 'es'} combined`;

  return (
    <div ref={containerRef} className={`relative inline-block text-left ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Switch location view (Complete Stock, Hub Warehouse, or Branch)"
        className="h-9 px-3 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-lg transition-all flex items-center gap-2 text-xs font-semibold shadow-2xs cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
      >
        {isAll ? (
          <Layers className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
        ) : isHub ? (
          <Warehouse className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        ) : (
          <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        )}

        <span className="truncate max-w-[140px] sm:max-w-[180px] text-slate-900">
          {triggerTitle}
        </span>

        <span
          className={`hidden md:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold border leading-none ${triggerTagClass}`}
        >
          {triggerTag}
        </span>

        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180 text-slate-600' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 mt-1.5 w-76 sm:w-80 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 overflow-hidden"
        >
          {/* Option 1: Complete Stock (All Locations: Hub + Branches) */}
          {includeAllLocations && (
            <div className="px-1.5 pb-1.5 border-b border-slate-100">
              <div className="px-2.5 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Chain Overview
              </div>
              <button
                type="button"
                role="option"
                aria-selected={isAll}
                onClick={() => handleSelect('all_locations')}
                className={`w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2.5 transition-colors cursor-pointer ${
                  isAll
                    ? 'bg-indigo-50/80 text-indigo-950'
                    : 'hover:bg-slate-50 text-slate-700'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
                    isAll
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-indigo-50 text-indigo-600 border-indigo-100'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {allLocationsLabel}
                    </span>
                    <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded bg-indigo-100 text-indigo-700 shrink-0">
                      Hub + Branches
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                    {resolvedAllSubtitle}
                  </p>
                </div>
                {isAll && <Check className="w-4 h-4 text-indigo-600 shrink-0 mt-1" />}
              </button>
            </div>
          )}

          {/* Option 2: Hub Warehouse (Main Office Storage) */}
          <div className="px-1.5 py-1.5 border-b border-slate-100">
            <div className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Main Office Storage
            </div>
            <button
              type="button"
              role="option"
              aria-selected={isHub}
              onClick={() => handleSelect('hub_warehouse')}
              className={`w-full text-left px-2.5 py-2 rounded-lg flex items-start gap-2.5 transition-colors cursor-pointer ${
                isHub
                  ? 'bg-amber-50/80 text-amber-950'
                  : 'hover:bg-slate-50 text-slate-700'
              }`}
            >
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
                  isHub
                    ? 'bg-amber-600 text-white border-amber-600'
                    : 'bg-amber-50 text-amber-600 border-amber-100'
                }`}
              >
                <Warehouse className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-bold text-slate-900 truncate">
                    {hubLabel}
                  </span>
                  <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded bg-amber-100 text-amber-800 shrink-0">
                    Main Office
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                  {hubSubtitle}
                </p>
              </div>
              {isHub && <Check className="w-4 h-4 text-amber-600 shrink-0 mt-1" />}
            </button>
          </div>

          {/* Option 3: Individual Retail Branches */}
          <div className="px-1.5 pt-1.5">
            <div className="px-2.5 pb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <span>Retail Branches</span>
              <span>{stores.length}</span>
            </div>
            {stores.length === 0 ? (
              <p className="px-2.5 py-3 text-xs text-slate-400 text-center">
                No branches configured yet
              </p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
                {stores.map((store) => {
                  if (!store.id) return null;
                  const storeId = store.id;
                  const isSelected = effectiveValue === storeId;
                  const codeBadge = (store as any).branchCode || store.branchId;
                  return (
                    <button
                      key={storeId}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(storeId)}
                      className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-50/80 text-emerald-950'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                          isSelected
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        <Building2 className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="text-xs font-semibold text-slate-900 truncate">
                            {store.name}
                          </span>
                          {codeBadge && (
                            <span className="px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded bg-slate-100 text-slate-600 shrink-0">
                              {codeBadge}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">
                          {store.address || 'Retail branch inventory'}
                        </p>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LocationSwitcher;

