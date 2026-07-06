import { Clock3, Grid2X2, Plus, Sparkles } from "lucide-react";
import { storyboardCards } from "../../app/mockWorkspace";

export const StoryboardPanel = () => {
  return (
    <section className="panel storyboard-panel" data-panel="storyboard">
      <div className="storyboard-tools">
        <div className="small-tool-group">
          <button className="icon-button is-muted" title="网格" type="button">
            <Grid2X2 size={16} />
          </button>
          <button className="icon-button is-muted" title="分镜设置" type="button">
            <Sparkles size={16} />
          </button>
        </div>
        <div className="panel-actions">
          <button className="ghost-button compact" type="button">
            <Sparkles size={15} />
            <span>生成分镜</span>
          </button>
          <button className="ghost-button compact" type="button">
            <Plus size={15} />
            <span>导入脚本</span>
          </button>
        </div>
      </div>

      <div className="storyboard-strip">
        {storyboardCards.map((card, index) => (
          <article
            className={index === 0 ? "story-card is-selected" : "story-card"}
            key={card.index}
          >
            <div className="story-index">{card.index}</div>
            <div className={`story-image ${card.variant}`}>
              <img alt="" src={card.thumbnail} />
            </div>
            <p>{card.title}</p>
            <div className="story-card-foot">
              <span>{index === 0 ? "8s" : index === 4 ? "4s" : card.duration}</span>
              <span>
                <Clock3 size={13} />
                {card.duration}
              </span>
            </div>
          </article>
        ))}
        <button className="story-add" type="button" title="新增分镜">
          <Plus size={34} />
        </button>
      </div>
    </section>
  );
};
